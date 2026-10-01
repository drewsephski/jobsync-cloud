import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import {
  createSessionContext,
  type CurrentAuthUser,
} from "../lib/auth/session-context"
import { createAccountDeletion } from "../lib/domain/account/deletion"
import { exportAccount } from "../lib/domain/account/export"
import { createDiscoveryWorker, MATCH_KIND } from "../lib/domain/discovery/worker"
import { createProcessingRuns } from "../lib/domain/processing-run/service"

nextEnv.loadEnvConfig(process.cwd())
const env = readFileSync(
  new URL("../.env.billingtest", import.meta.url),
  "utf8"
)
const match = env.match(
  /^BILLING_TEST_DATABASE_URL=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/m
)
assert.ok(match, "Configure a schema-only test branch in .env.billingtest")
const databaseUrl =
  process.env.BILLING_TEST_DATABASE_URL ?? match[1] ?? match[2] ?? match[3]
assert.ok(databaseUrl)
const databaseHost = new URL(databaseUrl).hostname
assert.ok(
  databaseHost.startsWith("ep-weathered-meadow-b46q35cx."),
  "account tests require the billing test branch"
)
assert.ok(
  !databaseHost.startsWith("ep-green-scene-b45djevq"),
  "account tests must not use the application branch"
)

// user-profile also initializes the framework database singleton at import time.
// This suite supplies safe, local-only values and pins that singleton to the test branch.
Object.assign(process.env, {
  AWS_ACCESS_KEY_ID: "account-test-access-key",
  AWS_SECRET_ACCESS_KEY: "account-test-secret-key",
  AWS_ENDPOINT_URL_S3: "https://storage.example.test",
  AWS_REGION: "us-east-2",
  APP_ORIGIN: "https://jobsync.example.test",
  DATABASE_URL: databaseUrl,
  NEON_AUTH_BASE_URL: "https://auth.example.test/auth",
  NEON_AUTH_COOKIE_SECRET: randomUUID().repeat(2),
})
const { ensureUserProfile } = await import("../lib/auth/user-profile")

const db = createDatabaseClient(databaseUrl)
const owners = new Set<string>()
const companies = new Set<string>()
const boards = new Set<string>()
const postings = new Set<string>()
const retainedBudgetCosts = new Set<bigint>()
after(async () => {
  const ownerIds = [...owners]
  try {
    if (ownerIds.length) {
      await db.applicationEvent.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.application.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.jobMatch.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
      await db.userJobState.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.companyWatch.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.discoveryAllowance.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.targetPreference.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.resume.updateMany({
        where: { ownerUserId: { in: ownerIds } },
        data: { confirmedVersionId: null, confirmedAt: null },
      })
      await db.resumeVersion.updateMany({
        where: { ownerUserId: { in: ownerIds } },
        data: { originDraftId: null },
      })
      await db.resumeVersion.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.resumeUpload.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.resume.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
      await db.aiUsage.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
      await db.aiUsageReservation.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.processingRun.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.billingSubscription.deleteMany({
        where: { customer: { ownerUserId: { in: ownerIds } } },
      })
      await db.billingWebhookEvent.deleteMany({
        where: {
          customerId: {
            in: (
              await db.billingCustomer.findMany({
                where: { ownerUserId: { in: ownerIds } },
                select: { id: true },
              })
            ).map((c) => c.id),
          },
        },
      })
      await db.billingCustomer.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.accountDeletionRequest.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      })
      await db.userProfile.deleteMany({ where: { id: { in: ownerIds } } })
    }
    for (const cost of retainedBudgetCosts)
      await db.deletedAccountAiBudget.deleteMany({
        where: { reservedCostMicroUsd: cost },
      })
    if (postings.size)
      await db.jobPosting.deleteMany({ where: { id: { in: [...postings] } } })
    if (boards.size)
      await db.atsBoard.deleteMany({ where: { id: { in: [...boards] } } })
    if (companies.size)
      await db.company.deleteMany({ where: { id: { in: [...companies] } } })
  } finally {
    await db.$disconnect()
  }
})

async function verifiedUser(id: string): Promise<CurrentAuthUser> {
  return createSessionContext(
    async () => ({
      data: {
        user: {
          id,
          name: "Account fixture",
          email: `${id}@example.test`,
          emailVerified: true,
        },
      },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
}

async function createOwner() {
  const id = `account-test-${randomUUID()}`
  await db.userProfile.create({
    data: { id, displayName: `Private ${id}`, emailVerifiedAt: new Date() },
  })
  owners.add(id)
  return id
}

async function createSharedPosting() {
  const suffix = randomUUID()
  const company = await db.company.create({
    data: {
      name: `Account Fixture ${suffix}`,
      slug: `account-fixture-${suffix}`,
    },
  })
  companies.add(company.id)
  const board = await db.atsBoard.create({
    data: {
      companyId: company.id,
      provider: "greenhouse",
      slug: `account-fixture-${suffix}`,
    },
  })
  boards.add(board.id)
  const posting = await db.jobPosting.create({
    data: {
      boardId: board.id,
      externalId: suffix,
      title: "Fixture Software Engineer",
      location: "Remote",
      description: "Public fixture description",
      originalUrl: `https://jobs.example.test/${suffix}`,
      contentHash: "a".repeat(64),
    },
  })
  postings.add(posting.id)
  return { company, board, posting }
}

async function seedPrivateRecords(
  owner: string,
  boardId: string,
  postingId: string,
  marker: string
) {
  await db.companyWatch.create({ data: { ownerUserId: owner, boardId } })
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: `Resume ${marker}` },
  })
  const draft = await db.resumeVersion.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      version: 1,
      source: "manual",
      status: "draft",
      data: { summary: `${marker} draft` },
    },
  })
  const confirmed = await db.resumeVersion.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      version: 2,
      source: "manual",
      status: "ready",
      originDraftId: draft.id,
      data: { summary: `${marker} private resume` },
    },
  })
  await db.resume.update({
    where: { id: resume.id },
    data: { confirmedVersionId: confirmed.id, confirmedAt: new Date() },
  })
  await db.targetPreference.create({
    data: {
      ownerUserId: owner,
      targetTitle: `Role ${marker}`,
      keywords: [marker],
    },
  })
  await db.jobMatch.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      resumeVersionId: confirmed.id,
      preferenceRevision: 0,
      preferenceHash: "b".repeat(64),
      jobPostingId: postingId,
      postingVersion: 1,
      postingHash: "a".repeat(64),
      algorithmVersion: "account-test-v1",
      inputKey: `account-test:${owner}:${randomUUID()}`,
      relevance: 80,
      reasons: [`${marker} private match reason`],
    },
  })
  await db.userJobState.create({
    data: { ownerUserId: owner, jobPostingId: postingId, state: "saved" },
  })
  const posting = await db.jobPosting.findUniqueOrThrow({
    where: { id: postingId },
    include: { board: { include: { company: true } } },
  })
  const application = await db.application.create({
    data: {
      ownerUserId: owner,
      jobPostingId: postingId,
      sourcePostingKey: postingId,
      creationKey: randomUUID(),
      sourceSnapshot: { kind: "account-test", posting: { id: postingId } },
      company: posting.board.company.name,
      title: posting.title,
      location: posting.location,
      notes: `${marker} private application note`,
      status: "saved",
      resumeId: resume.id,
      resumeVersionId: confirmed.id,
      resumeSnapshot: { title: resume.title, version: confirmed.version },
      events: {
        create: {
          revision: 1,
          kind: "created",
          toStatus: "saved",
          occurredOn: new Date(),
        },
      },
    },
  })
  return { resume, draft, confirmed, application }
}

test("account export isolates private data while preserving shared board and posting context", async () => {
  const owner = await createOwner()
  const otherOwner = await createOwner()
  const { board, posting } = await createSharedPosting()
  await seedPrivateRecords(owner, board.id, posting.id, "owner-one-secret")
  await seedPrivateRecords(otherOwner, board.id, posting.id, "owner-two-secret")

  const result = await exportAccount(db, await verifiedUser(owner))
  assert.equal(result.format, "jobsync-cloud-export-v1")
  assert.equal(result.companyWatches.length, 1)
  assert.deepEqual(result.companyWatches[0]?.board, {
    provider: "greenhouse",
    slug: board.slug,
    company: {
      name: `Account Fixture ${board.slug.slice("account-fixture-".length)}`,
    },
  })
  assert.equal(result.resumes.length, 1)
  assert.match(
    JSON.stringify(result.resumes),
    /owner-one-secret private resume/
  )
  assert.doesNotMatch(JSON.stringify(result), /owner-two-secret/)
  assert.equal(result.matches.length, 1)
  assert.equal(result.savedJobStates.length, 1)
  assert.match(
    JSON.stringify(result.matches),
    /owner-one-secret private match reason/
  )
  assert.equal(result.applications.length, 1)
  assert.match(
    JSON.stringify(result.applications),
    /owner-one-secret private application note/
  )
  assert.doesNotMatch(JSON.stringify(result.applications), /owner-two-secret/)
  assert.equal(
    (await db.jobPosting.findUnique({ where: { id: posting.id } }))?.id,
    posting.id
  )
})

test("deletion marks work canceled and defers while a worker lease or signed upload can still be used", async () => {
  const owner = await createOwner()
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: "Deferred cleanup fixture" },
  })
  const pending = await db.processingRun.create({
    data: {
      ownerUserId: owner,
      kind: "account-test-pending",
      resourceId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
  })
  const active = await db.processingRun.create({
    data: {
      ownerUserId: owner,
      kind: "account-test-active",
      resourceId: randomUUID(),
      idempotencyKey: randomUUID(),
      status: "running",
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 120_000),
      startedAt: new Date(),
    },
  })
  const upload = await db.resumeUpload.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      objectKey: `account-test/${owner}/${randomUUID()}`,
      originalFileName: "pending.pdf",
      declaredContentType: "application/pdf",
      declaredSizeBytes: 128,
      status: "pending",
      expiresAt: new Date(Date.now() + 120_000),
    },
  })
  const deletion = createAccountDeletion(db, {
    deleteBilling: async () => {},
    deleteFiles: async () => {},
    deleteIdentity: async () => {},
  })
  await deletion.request(owner)
  let matcherCalled = false
  const discovery = createDiscoveryWorker(db, async () => {
    matcherCalled = true
    throw new Error("matcher must not run for a deleting owner")
  })
  const [matchesBefore, discoveryRunsBefore] = await Promise.all([
    db.jobMatch.count({ where: { ownerUserId: owner } }),
    db.processingRun.count({ where: { ownerUserId: owner, kind: MATCH_KIND } }),
  ])
  assert.deepEqual(await discovery.plan(owner), {
    considered: 0,
    eligible: 0,
    queued: 0,
  })
  assert.equal(matcherCalled, false)
  assert.equal(await db.jobMatch.count({ where: { ownerUserId: owner } }), matchesBefore)
  assert.equal(
    await db.processingRun.count({ where: { ownerUserId: owner, kind: MATCH_KIND } }),
    discoveryRunsBefore
  )
  assert.ok(
    (await db.processingRun.findUniqueOrThrow({ where: { id: pending.id } }))
      .cancellationRequestedAt
  )
  assert.ok(
    (await db.processingRun.findUniqueOrThrow({ where: { id: active.id } }))
      .cancellationRequestedAt
  )

  const claim = await createProcessingRuns(db).claim(pending.kind, pending.id)
  assert.equal(claim, null)
  assert.equal(
    (await db.processingRun.findUniqueOrThrow({ where: { id: pending.id } }))
      .status,
    "canceled"
  )
  assert.equal(await deletion.process(owner), "retry_wait")
  const request = await db.accountDeletionRequest.findUniqueOrThrow({
    where: { ownerUserId: owner },
  })
  assert.equal(request.errorCode, "cleanup_work_quiescence")
  assert.ok(await db.userProfile.findUnique({ where: { id: owner } }))
  assert.ok(await db.resumeUpload.findUnique({ where: { id: upload.id } }))

  await db.processingRun.update({
    where: { id: active.id },
    data: { leaseExpiresAt: new Date(0) },
  })
  await db.accountDeletionRequest.update({
    where: { ownerUserId: owner },
    data: { availableAt: new Date(0) },
  })
  assert.equal(await deletion.process(owner), "retry_wait")
  assert.equal(
    (
      await db.accountDeletionRequest.findUniqueOrThrow({
        where: { ownerUserId: owner },
      })
    ).errorCode,
    "cleanup_work_quiescence"
  )
  assert.ok(await db.resumeUpload.findUnique({ where: { id: upload.id } }))
})

test("deletion retries injected billing, storage and identity failures, removes FK dependents in order and leaves only anonymous budget evidence", async () => {
  const owner = await createOwner()
  const survivor = await createOwner()
  const { board, posting } = await createSharedPosting()
  const records = await seedPrivateRecords(
    owner,
    board.id,
    posting.id,
    "delete-owner"
  )
  await seedPrivateRecords(survivor, board.id, posting.id, "survivor-owner")
  const customer = await db.billingCustomer.create({
    data: {
      ownerUserId: owner,
      livemode: false,
      stripeCustomerId: `cus_account_${randomUUID()}`,
    },
  })
  await db.billingSubscription.create({
    data: {
      stripeSubscriptionId: `sub_account_${randomUUID()}`,
      customerId: customer.id,
      stripePriceId: "price_fixture",
      status: "active",
      currentPeriodStart: new Date(Date.now() - 60_000),
      currentPeriodEnd: new Date(Date.now() + 60_000),
      stripeCreatedAt: new Date(),
      lastEventId: `evt_${randomUUID()}`,
      reconciledAt: new Date(),
    },
  })
  const budgetCost = BigInt(
    900_000_000 + Math.floor(Math.random() * 50_000_000)
  )
  retainedBudgetCosts.add(budgetCost)
  await db.aiUsageReservation.create({
    data: {
      ownerUserId: owner,
      feature: "resume",
      idempotencyKey: `account-test:${randomUUID()}`,
      reservedUnits: BigInt(1),
      reservedCostMicroUsd: budgetCost,
      expiresAt: new Date(Date.now() + 60_000),
      status: "reconciliation_required",
      finalCostMicroUsd: null,
    },
  })

  const order: string[] = []
  let failBilling = true
  let failStorage = true
  let failIdentity = true
  const deletion = createAccountDeletion(db, {
    deleteBilling: async () => {
      order.push("billing")
      if (failBilling) throw new Error("provider details must stay private")
    },
    deleteFiles: async () => {
      order.push("storage")
      if (failStorage) throw new Error("storage details must stay private")
    },
    deleteIdentity: async () => {
      order.push("identity")
      if (failIdentity) throw new Error("auth details must stay private")
    },
  })
  await deletion.request(owner)
  assert.equal(await deletion.process(owner), "retry_wait")
  assert.equal(
    (
      await db.accountDeletionRequest.findUniqueOrThrow({
        where: { ownerUserId: owner },
      })
    ).errorCode,
    "cleanup_billing"
  )
  failBilling = false
  await db.accountDeletionRequest.update({
    where: { ownerUserId: owner },
    data: { availableAt: new Date(0) },
  })
  assert.equal(await deletion.process(owner), "retry_wait")
  assert.equal(
    (
      await db.accountDeletionRequest.findUniqueOrThrow({
        where: { ownerUserId: owner },
      })
    ).errorCode,
    "cleanup_storage"
  )
  failStorage = false
  await db.accountDeletionRequest.update({
    where: { ownerUserId: owner },
    data: { availableAt: new Date(0) },
  })
  assert.equal(await deletion.process(owner), "retry_wait")
  assert.equal(
    (
      await db.accountDeletionRequest.findUniqueOrThrow({
        where: { ownerUserId: owner },
      })
    ).errorCode,
    "cleanup_identity"
  )
  assert.equal(await db.userProfile.findUnique({ where: { id: owner } }), null)
  assert.equal(
    await db.resume.findUnique({ where: { id: records.resume.id } }),
    null
  )
  assert.equal(
    await db.resumeVersion.count({ where: { ownerUserId: owner } }),
    0
  )
  assert.equal(await db.application.count({ where: { ownerUserId: owner } }), 0)
  assert.equal(
    await db.applicationEvent.count({ where: { ownerUserId: owner } }),
    0
  )
  assert.equal(
    await db.billingCustomer.count({ where: { ownerUserId: owner } }),
    0
  )
  const evidence = await db.deletedAccountAiBudget.findMany({
    where: { reservedCostMicroUsd: budgetCost },
  })
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0]?.finalCostMicroUsd, null)
  assert.deepEqual(
    Object.keys(evidence[0] ?? {}).sort(),
    ["finalCostMicroUsd", "id", "incurredAt", "reservedCostMicroUsd"].sort()
  )
  failIdentity = false
  await db.accountDeletionRequest.update({
    where: { ownerUserId: owner },
    data: { availableAt: new Date(0) },
  })
  assert.equal(await deletion.process(owner), "completed")
  assert.ok(order.indexOf("billing") < order.indexOf("storage"))
  assert.ok(order.indexOf("storage") < order.indexOf("identity"))
  assert.equal(
    await db.companyWatch.count({
      where: { ownerUserId: survivor, boardId: board.id },
    }),
    1
  )
  assert.equal(
    (await db.jobPosting.findUnique({ where: { id: posting.id } }))?.id,
    posting.id
  )

  const resurrection = await verifiedUser(owner)
  await assert.rejects(ensureUserProfile(resurrection, db), /account_deleting/)
  assert.equal(await db.userProfile.findUnique({ where: { id: owner } }), null)
  assert.equal(
    (
      await db.accountDeletionRequest.findUniqueOrThrow({
        where: { ownerUserId: owner },
      })
    ).status,
    "completed"
  )
})
