import type { PrismaClient } from "../../generated/prisma/client"
import type { CurrentAuthUser } from "../../auth/session-context"
import { requireActiveAccount } from "./guard"

export async function exportAccount(db: PrismaClient, user: CurrentAuthUser) {
  return db.$transaction(
    async (tx) => {
      const profile = await requireActiveAccount(tx, user.id)
      const where = { ownerUserId: user.id }
      const [
        resumes,
        preferences,
        applications,
        watches,
        matches,
        states,
        usage,
        allowances,
        customers,
      ] = await Promise.all([
        tx.resume.findMany({
          where,
          include: { versions: true, uploads: true },
        }),
        tx.targetPreference.findMany({ where }),
        tx.application.findMany({ where, include: { events: true } }),
        tx.companyWatch.findMany({
          where,
          include: {
            board: {
              select: {
                provider: true,
                slug: true,
                company: { select: { name: true } },
              },
            },
          },
        }),
        tx.jobMatch.findMany({ where }),
        tx.userJobState.findMany({ where }),
        tx.aiUsageReservation.findMany({
          where,
          select: {
            feature: true,
            reservedUnits: true,
            consumedUnits: true,
            status: true,
            billingPeriodStart: true,
            billingPeriodEnd: true,
            createdAt: true,
          },
        }),
        tx.discoveryAllowance.findMany({ where }),
        tx.billingCustomer.findMany({
          where,
          include: { subscriptions: true },
        }),
      ])
      // Export personal content and plan history. Capability URLs, auth/session
      // secrets and provider request IDs are never included in this document.
      return {
        format: "jobsync-cloud-export-v1",
        exportedAt: new Date().toISOString(),
        account: {
          name: profile.displayName,
          email: user.email,
          timezone: profile.timezone,
          createdAt: profile.createdAt,
          onboardingCompletedAt: profile.onboardingCompletedAt,
        },
        resumes: resumes.map((r) => ({
          title: r.title,
          confirmedVersionId: r.confirmedVersionId,
          confirmedAt: r.confirmedAt,
          versions: r.versions.map((v) => ({
            id: v.id,
            version: v.version,
            source: v.source,
            status: v.status,
            content: v.data,
            extractedText: v.extractedText,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
          })),
          files: r.uploads.map((u) => ({
            id: u.id,
            fileName: u.originalFileName,
            status: u.status,
            uploadedAt: u.uploadedAt,
            sizeBytes: u.actualSizeBytes,
          })),
        })),
        preferences,
        applications,
        companyWatches: watches.map((w) => ({
          board: w.board,
          createdAt: w.createdAt,
        })),
        matches,
        savedJobStates: states,
        usage: { ai: usage, discovery: allowances },
        billing: customers.map((c) => ({
          mode: c.livemode ? "live" : "test",
          subscriptions: c.subscriptions.map((s) => ({
            status: s.status,
            currentPeriodStart: s.currentPeriodStart,
            currentPeriodEnd: s.currentPeriodEnd,
            cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          })),
        })),
        originals:
          "Original resume files are delivered as authenticated downloads separately from this JSON export.",
      }
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 }
  )
}
