import { randomUUID } from "node:crypto"
import type { PrismaClient } from "../../generated/prisma/client"
import { UploadError } from "../resume-upload/service"

export interface AccountCleanup {
  deleteFiles(owner: string): Promise<void>
  deleteBilling(customer: {
    id: string
    ownerUserId: string
    stripeCustomerId: string | null
    livemode: boolean
    checkoutSessionId: string | null
  }): Promise<void>
  deleteIdentity(owner: string): Promise<void>
}

export function createAccountDeletion(
  db: PrismaClient,
  cleanup: AccountCleanup
) {
  async function request(owner: string) {
    return db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234103, hashtext(${owner}))`
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "UserProfile" WHERE id=${owner} FOR NO KEY UPDATE`
        if (!rows.length) throw new UploadError("account_not_found", 404)
        await tx.userProfile.update({
          where: { id: owner },
          data: { deletionRequestedAt: new Date() },
        })
        const queued = await tx.accountDeletionRequest.upsert({
          where: { ownerUserId: owner },
          create: { ownerUserId: owner },
          update: {},
        })
        await tx.processingRun.updateMany({
          where: {
            ownerUserId: owner,
            status: { in: ["pending", "running", "retry_wait"] },
          },
          data: { cancellationRequestedAt: new Date() },
        })
        return {
          status: queued.status,
          requestedAt: queued.requestedAt.toISOString(),
        }
      },
      { timeout: 30_000 }
    )
  }

  async function process(owner: string) {
    const token = randomUUID()
    const rows = await db.$queryRaw<{ ownerUserId: string; attempt: number }[]>`
      UPDATE "AccountDeletionRequest" SET status='running',attempt=attempt+1,"leaseToken"=${token}::uuid,
        "leaseExpiresAt"=now()+interval '10 minutes',"updatedAt"=now()
      WHERE "ownerUserId"=${owner} AND status <> 'completed' AND "availableAt" <= now()
        AND (status <> 'running' OR "leaseExpiresAt" <= now()) RETURNING "ownerUserId",attempt`
    if (!rows.length) return "not_claimed"
    const fence = async () => {
      const row = await db.accountDeletionRequest.findFirst({
        where: {
          ownerUserId: owner,
          leaseToken: token,
          leaseExpiresAt: { gt: new Date() },
        },
      })
      if (!row) throw new Error("cleanup_lease_lost")
    }
    let stage = "work_quiescence"
    try {
      // Wait for active callbacks and every already-issued upload capability.
      // Cancellation prevents renew/claim. Deleting files sooner allows a late
      // signed PUT to recreate private objects after a successful cleanup.
      const [active, latestUpload] = await Promise.all([
        db.processingRun.count({
          where: {
            ownerUserId: owner,
            status: "running",
            leaseExpiresAt: { gt: new Date() },
          },
        }),
        db.resumeUpload.findFirst({
          where: { ownerUserId: owner },
          orderBy: { expiresAt: "desc" },
          select: { expiresAt: true },
        }),
      ])
      if (
        active ||
        (latestUpload && latestUpload.expiresAt.getTime() + 60_000 > Date.now())
      )
        throw new Error("cleanup_waiting")
      await fence()
      stage = "billing"
      for (const customer of await db.billingCustomer.findMany({
        where: { ownerUserId: owner },
      })) {
        await cleanup.deleteBilling(customer)
        await fence()
      }
      stage = "storage"
      await cleanup.deleteFiles(owner)
      await fence()
      stage = "private_records"
      await db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "ownerUserId" AS id FROM "AccountDeletionRequest" WHERE "ownerUserId"=${owner} AND "leaseToken"=${token}::uuid AND "leaseExpiresAt">now() FOR UPDATE`
          if (!locked.length) throw new Error("cleanup_lease_lost")
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234103, hashtext(${owner}))`
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234102)`
          // Private accounting is removed, while only anonymous cost envelopes
          // remain for the global budget. Unknown costs never become zero.
          const reservations = await tx.aiUsageReservation.findMany({
            where: { ownerUserId: owner, status: { not: "released" } },
          })
          if (reservations.length)
            await tx.deletedAccountAiBudget.createMany({
              data: reservations.map((r) => ({
                incurredAt: r.createdAt,
                reservedCostMicroUsd: r.reservedCostMicroUsd,
                finalCostMicroUsd: r.finalCostMicroUsd,
              })),
            })
          const where = { ownerUserId: owner }
          await tx.application.deleteMany({ where })
          await tx.jobMatch.deleteMany({ where })
          await tx.userJobState.deleteMany({ where })
          await tx.companyWatch.deleteMany({ where })
          await tx.discoveryAllowance.deleteMany({ where })
          await tx.targetPreference.deleteMany({ where })
          await tx.resume.updateMany({
            where,
            data: { confirmedVersionId: null, confirmedAt: null },
          })
          await tx.resumeVersion.updateMany({
            where,
            data: { originDraftId: null },
          })
          await tx.resumeVersion.deleteMany({ where })
          await tx.resumeUpload.deleteMany({ where })
          await tx.resume.deleteMany({ where })
          await tx.aiUsage.deleteMany({ where })
          await tx.aiUsageReservation.deleteMany({ where })
          await tx.processingRun.deleteMany({ where })
          await tx.billingSubscription.deleteMany({
            where: { customer: { ownerUserId: owner } },
          })
          await tx.billingCustomer.deleteMany({ where })
          await tx.userProfile.deleteMany({ where: { id: owner } })
        },
        { timeout: 30_000 }
      )
      stage = "identity"
      await cleanup.deleteIdentity(owner)
      await fence()
      await db.accountDeletionRequest.updateMany({
        where: { ownerUserId: owner, leaseToken: token },
        data: {
          status: "completed",
          completedAt: new Date(),
          errorCode: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      return "completed"
    } catch {
      await db.accountDeletionRequest.updateMany({
        where: { ownerUserId: owner, leaseToken: token },
        data: {
          status: "retry_wait",
          errorCode: `cleanup_${stage}`,
          availableAt: new Date(
            Date.now() +
              Math.min(3600_000, 60_000 * 2 ** Math.min(rows[0].attempt, 6))
          ),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      // Fixed stage names only: never log dependency errors or account IDs.
      console.info(JSON.stringify({ event: "account_cleanup_retry", stage }))
      return "retry_wait"
    }
  }
  async function recover() {
    const due = await db.accountDeletionRequest.findMany({
      where: {
        status: { not: "completed" },
        availableAt: { lte: new Date() },
        OR: [
          { status: { not: "running" } },
          { leaseExpiresAt: { lte: new Date() } },
        ],
      },
      orderBy: { requestedAt: "asc" },
      take: 5,
    })
    const results = []
    for (const row of due) results.push(await process(row.ownerUserId))
    return {
      processed: results.length,
      completed: results.filter((r) => r === "completed").length,
    }
  }
  return { request, process, recover }
}
