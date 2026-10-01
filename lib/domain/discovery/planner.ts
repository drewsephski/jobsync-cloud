import { randomUUID } from "node:crypto"
import type { PrismaClient } from "../../generated/prisma/client"
import { readEntitlement } from "../../billing/entitlements"
import { profileInputs } from "./inputs"
import { freshBoardFilter } from "./catalog"
import {
  ALGORITHM_VERSION,
  fingerprint,
  prerank,
  titleSearchTerms,
  MAX_AI_PER_USER_DAY,
  MAX_FEED_CANDIDATES,
} from "./relevance"

export const MATCH_KIND = "job_match_v1"
export const MAX_SCAN_POSTINGS = 3000
export type PlanOptions = { boardId?: string; incremental?: boolean }
const empty = {
  considered: 0,
  catalogPostings: 0,
  eligible: 0,
  surfaced: 0,
  queued: 0,
}

export function createDiscoveryPlanner(db: PrismaClient) {
  return async function plan(ownerUserId: string, options: PlanOptions = {}) {
    const start = Date.now()
    return db.$transaction(
      async (tx) => {
        const active = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "UserProfile" WHERE id=${ownerUserId} AND "deletionRequestedAt" IS NULL FOR NO KEY UPDATE`
        if (!active.length) return empty
        const entitlement = await readEntitlement(tx, ownerUserId)
        if (!entitlement.verified || !entitlement.limits) return empty
        const input = await profileInputs(tx, ownerUserId)
        if (!input) return empty
        const boards = await tx.atsBoard.findMany({
          where: {
            ...freshBoardFilter(),
            ...(options.boardId ? { id: options.boardId } : {}),
          },
          select: { id: true, lastSuccessAt: true },
          orderBy: { id: "asc" },
        })
        const identity = fingerprint([
          input.version.id,
          input.profile.preferenceRevision,
          input.preferenceHash,
          ALGORITHM_VERSION,
        ])
        const scanKey = `${identity}:${fingerprint(boards)}`
        const periodStart = new Date(
          new Date().toISOString().slice(0, 10) + "T00:00:00Z"
        )
        const allowance = await tx.discoveryAllowance.findUnique({
          where: { ownerUserId_periodStart: { ownerUserId, periodStart } },
        })
        const latestScan = await tx.discoveryAllowance.findFirst({
          where: { ownerUserId },
          orderBy: { lastScannedAt: "desc" },
        })
        const incremental = !!options.boardId || !!options.incremental
        const inputsChanged =
          !!input.profile.discoveryInputKey &&
          !input.profile.discoveryInputKey.startsWith(identity + ":")
        // The paid-plan scan allowance still bounds full repeated searches. Exact
        // input changes and newly ingested boards can repair relevance immediately.
        if (
          !incremental &&
          !inputsChanged &&
          ((allowance?.scans ?? 0) >= entitlement.limits.dailyScans ||
            (latestScan &&
              scanKey === input.profile.discoveryInputKey &&
              Date.now() - latestScan.lastScannedAt.getTime() < 12 * 3600_000))
        )
          return empty
        if (
          options.incremental &&
          !options.boardId &&
          scanKey === input.profile.discoveryInputKey &&
          !input.profile.discoveryCursor
        )
          return empty
        const where = { open: true, boardId: { in: boards.map((b) => b.id) } }
        const catalogPostings = await tx.jobPosting.count({ where })
        const cursor =
          !options.boardId &&
          input.profile.discoveryInputKey?.startsWith(identity + ":")
            ? input.profile.discoveryCursor
            : null
        const page = await tx.jobPosting.findMany({
          where: {
            ...where,
            OR: titleSearchTerms(input.targets).map((term) => ({
              title: { contains: term, mode: "insensitive" as const },
            })),
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: MAX_SCAN_POSTINGS + 1,
        })
        const postings = page.slice(0, MAX_SCAN_POSTINGS)
        if (!incremental)
          await tx.discoveryAllowance.upsert({
            where: { ownerUserId_periodStart: { ownerUserId, periodStart } },
            create: { ownerUserId, periodStart, scans: 1 },
            update: {
              scans: { increment: inputsChanged ? 0 : 1 },
              lastScannedAt: new Date(),
            },
          })
        if (!options.boardId)
          await tx.userProfile.update({
            where: { id: ownerUserId },
            data: {
              // Finish an in-progress sweep despite refreshed boards. Keep its
              // original catalog key so a changed snapshot gets a new sweep next.
              discoveryInputKey: cursor
                ? input.profile.discoveryInputKey
                : scanKey,
              discoveryCursor:
                page.length > MAX_SCAN_POSTINGS ? postings.at(-1)!.id : null,
            },
          })
        const ranked = postings
          .map((posting) => ({
            posting,
            result: prerank(posting, input.targets, input.content),
          }))
          .filter((p) => p.result.eligible)
          .sort(
            (a, b) =>
              b.result.score - a.result.score ||
              a.posting.id.localeCompare(b.posting.id)
          )
        const selected = ranked
          .slice(0, MAX_FEED_CANDIDATES)
          .map(({ posting, result }) => ({
            id: randomUUID(),
            ownerUserId,
            resumeId: input.resume.id,
            resumeVersionId: input.version.id,
            preferenceRevision: input.profile.preferenceRevision,
            preferenceHash: input.preferenceHash,
            jobPostingId: posting.id,
            postingVersion: posting.contentVersion,
            postingHash: posting.contentHash,
            algorithmVersion: ALGORITHM_VERSION,
            inputKey: fingerprint([
              ownerUserId,
              input.version.id,
              input.profile.preferenceRevision,
              input.preferenceHash,
              posting.id,
              posting.contentVersion,
              posting.contentHash,
              ALGORITHM_VERSION,
            ]),
            relevance: result.score,
            reasons: result.reasons,
          }))
        // One write and bounded lookups replace the old three round trips/card.
        await tx.jobMatch.createMany({ data: selected, skipDuplicates: true })
        const matches = await tx.jobMatch.findMany({
          where: {
            ownerUserId,
            inputKey: { in: selected.map((m) => m.inputKey) },
          },
        })
        const dismissed = new Set(
          (
            await tx.userJobState.findMany({
              where: {
                ownerUserId,
                state: "dismissed",
                jobPostingId: { in: selected.map((m) => m.jobPostingId) },
              },
              select: { jobPostingId: true },
            })
          ).map((s) => s.jobPostingId)
        )
        const existingRuns = await tx.processingRun.findMany({
          where: {
            ownerUserId,
            kind: MATCH_KIND,
            OR: [
              { createdAt: { gte: periodStart } },
              { resourceId: { in: matches.map((m) => m.id) } },
            ],
          },
          select: { resourceId: true, createdAt: true },
        })
        const existing = new Set(existingRuns.map((r) => r.resourceId))
        const remaining = Math.max(
          0,
          MAX_AI_PER_USER_DAY -
            existingRuns.filter((r) => r.createdAt >= periodStart).length
        )
        const matchMap = new Map(matches.map((m) => [m.inputKey, m]))
        const candidates = selected
          .map((s) => matchMap.get(s.inputKey)!)
          .filter(
            (m) =>
              !m.aiAnalyzedAt &&
              !dismissed.has(m.jobPostingId) &&
              !existing.has(m.id)
          )
          .slice(0, remaining)
        const queued = (
          await tx.processingRun.createMany({
            data: candidates.map((m) => ({
              ownerUserId,
              kind: MATCH_KIND,
              resourceId: m.id,
              idempotencyKey: `user:${ownerUserId}:match:${m.inputKey}`,
            })),
            skipDuplicates: true,
          })
        ).count
        const funnel = {
          considered: postings.length,
          catalogPostings,
          eligible: ranked.length,
          surfaced: selected.length,
          queued,
          latencyMs: Date.now() - start,
        }
        await tx.processingRun.create({
          data: {
            ownerUserId,
            kind: "discovery_plan_v1",
            resourceId: ownerUserId,
            idempotencyKey: `plan:${ownerUserId}:${randomUUID()}`,
            status: "succeeded",
            completedAt: new Date(),
            checkpoint: {
              ...funnel,
              incremental,
              boardId: options.boardId ?? null,
              resumeVersionId: input.version.id,
              preferenceRevision: input.profile.preferenceRevision,
            },
          },
        })
        return funnel
      },
      { timeout: 30_000 }
    )
  }
}
