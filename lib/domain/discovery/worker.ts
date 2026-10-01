import {
  discoveryEligibleOwner,
  readEntitlement,
} from "../../billing/entitlements"
import { randomUUID } from "node:crypto"
import type {
  Prisma,
  PrismaClient,
  ProcessingRun,
} from "../../generated/prisma/client"
import { createProcessingRuns, LostLeaseError } from "../processing-run/service"
import {
  lockLiveRun,
  createAiAccounting,
  AllowanceError,
} from "../resume-structure/accounting"
import { MATCH_AI_CONFIG } from "../../ai/config"
import { matchSchema, type Matcher, type MatchResult } from "../../ai/matching"
import { profileInputs } from "./inputs"
export { profileInputs } from "./inputs"
import { fetchBoard } from "./providers"
import {
  ALGORITHM_VERSION,
  fingerprint,
  prerank,
  MAX_AI_PER_USER_DAY,
  MAX_FEED_CANDIDATES,
} from "./relevance"
export const INGEST_KIND = "board_ingest_v1"
export const MATCH_KIND = "job_match_v1"
export const FRESHNESS_MS = 6 * 60 * 60 * 1000
export function createDiscoveryWorker(
  db: PrismaClient,
  matcher: Matcher,
  fetcher = fetchBoard
) {
  const runs = createProcessingRuns(db)
  const accounting = createAiAccounting(
    db,
    MATCH_AI_CONFIG,
    MATCH_KIND,
    "discovery"
  )
  async function ensureBoard(boardId: string) {
    return db.$transaction(async (tx) => {
      // Capture due state and generation in the same statement. A concurrent
      // successful ingestion cannot turn an old due read into a new generation.
      const board = await tx.atsBoard.findFirst({
        where: {
          id: boardId,
          enabled: true,
          nextFetchAt: { lte: new Date() },
          watches: {
            some: {
              owner: discoveryEligibleOwner(),
            },
          },
        },
      })
      if (!board) return null
      const key = `board:${board.id}:ingest:v1:${board.fetchCount}`
      const [run] = await tx.$queryRaw<
        ProcessingRun[]
      >`INSERT INTO "ProcessingRun" (id,kind,"resourceId","idempotencyKey","updatedAt")
        VALUES (${randomUUID()}::uuid,${INGEST_KIND},${board.id},${key},now())
        ON CONFLICT ("idempotencyKey") DO UPDATE SET "idempotencyKey"=EXCLUDED."idempotencyKey"
        WHERE "ProcessingRun"."ownerUserId" IS NULL AND "ProcessingRun".kind=${INGEST_KIND} AND "ProcessingRun"."resourceId"=${board.id}
        RETURNING *`
      if (!run) throw new Error("idempotency_conflict")
      if (["failed", "canceled"].includes(run.status)) {
        await tx.atsBoard.updateMany({
          where: { id: board.id, fetchCount: board.fetchCount },
          data: {
            fetchCount: { increment: 1 },
            nextFetchAt: new Date(Date.now() + FRESHNESS_MS),
            errorCode: "provider_unavailable",
          },
        })
        return null
      }
      return run
    })
  }
  async function ingest(id: string | null = null) {
    const run = await runs.claim(INGEST_KIND, id)
    if (!run) return "not_claimed"
    const start = Date.now()
    try {
      if (run.ownerUserId !== null)
        return runs.finish(run, "failed", "invalid_run_owner")
      const board = await db.atsBoard.findUniqueOrThrow({
        where: { id: run.resourceId },
      })
      if (
        !board.enabled ||
        !(await db.companyWatch.findFirst({
          where: { boardId: board.id, owner: discoveryEligibleOwner() },
        }))
      )
        return runs.finish(run, "canceled", null)
      const jobs = await fetcher(board)
      await runs.renew(run)
      await db.$transaction(
        async (tx) => {
          await lockLiveRun(tx, run)
          await tx.$queryRaw`SELECT id FROM "AtsBoard" WHERE id = ${board.id}::uuid FOR UPDATE`
          const current = await tx.atsBoard.findUniqueOrThrow({
            where: { id: board.id },
          })
          if (
            run.idempotencyKey !==
            `board:${board.id}:ingest:v1:${current.fetchCount}`
          )
            throw new LostLeaseError()
          const now = new Date()
          const payload = jobs.map((job) => ({
            ...job,
            id: randomUUID(),
            publishedAt: job.publishedAt?.toISOString() ?? null,
          }))
          // One set-based upsert handles large boards without N network round trips.
          await tx.$executeRaw`INSERT INTO "JobPosting" (id,"boardId","externalId",title,location,remote,description,"originalUrl","publishedAt","contentHash","lastSeenAt")
          SELECT id::uuid,${board.id}::uuid,"externalId",title,location,remote,description,"originalUrl","publishedAt"::timestamptz,"contentHash",now()
          FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS j(id text,"externalId" text,title text,location text,remote boolean,description text,"originalUrl" text,"publishedAt" text,"contentHash" text)
          ON CONFLICT ("boardId","externalId") DO UPDATE SET title=EXCLUDED.title,location=EXCLUDED.location,remote=EXCLUDED.remote,description=EXCLUDED.description,
            "originalUrl"=EXCLUDED."originalUrl","publishedAt"=EXCLUDED."publishedAt","contentHash"=EXCLUDED."contentHash",
            "contentVersion"="JobPosting"."contentVersion" + CASE WHEN "JobPosting"."contentHash" <> EXCLUDED."contentHash" OR NOT "JobPosting".open THEN 1 ELSE 0 END,
            open=true,"closedAt"=NULL,"missingCount"=0,"lastSeenAt"=now()`
          // Only complete successful snapshots reach here. Two consecutive misses.
          const seen = jobs.map((j) => j.externalId)
          await tx.$executeRaw`UPDATE "JobPosting" SET "missingCount"="missingCount"+1,
          open=CASE WHEN "missingCount">=1 THEN false ELSE open END,
          "closedAt"=CASE WHEN "missingCount">=1 THEN now() ELSE "closedAt" END,
          "contentVersion"="contentVersion" + CASE WHEN "missingCount">=1 THEN 1 ELSE 0 END
          WHERE "boardId"=${board.id}::uuid AND open AND NOT ("externalId" = ANY(${seen}::text[]))`
          await tx.atsBoard.update({
            where: { id: board.id },
            data: {
              fetchCount: { increment: 1 },
              lastSuccessAt: now,
              nextFetchAt: new Date(now.getTime() + FRESHNESS_MS),
              errorCode: null,
            },
          })
          await tx.processingRun.update({
            where: { id: run.id },
            data: {
              status: "succeeded",
              completedAt: now,
              leaseToken: null,
              leaseExpiresAt: null,
              checkpoint: {
                ingested: jobs.length,
                durationMs: Date.now() - start,
              },
            },
          })
        },
        { timeout: 60_000 }
      )
      return "succeeded"
    } catch (error) {
      if (error instanceof LostLeaseError) return "lost_lease"
      await db
        .$transaction(async (tx) => {
          await lockLiveRun(tx, run)
          await tx.atsBoard.update({
            where: { id: run.resourceId },
            data: {
              errorCode: "provider_unavailable",
              nextFetchAt: new Date(Date.now() + 60_000),
            },
          })
        })
        .catch((e) => {
          if (!(e instanceof LostLeaseError)) throw e
        })
      return runs.retry(run, "provider_unavailable").catch((error) => {
        if (error instanceof LostLeaseError) return "lost_lease"
        throw error
      })
    }
  }
  async function plan(ownerUserId: string) {
    return db.$transaction(
      async (tx) => {
        const active = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "UserProfile" WHERE id = ${ownerUserId} AND "deletionRequestedAt" IS NULL FOR NO KEY UPDATE`
        if (!active.length) return { considered: 0, eligible: 0, queued: 0 }
        const entitlement = await readEntitlement(tx, ownerUserId)
        if (!entitlement.verified || !entitlement.limits)
          return { considered: 0, eligible: 0, queued: 0 }
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
        if (
          (allowance?.scans ?? 0) >= entitlement.limits.dailyScans ||
          (latestScan &&
            Date.now() - latestScan.lastScannedAt.getTime() < 12 * 3600_000)
        )
          return { considered: 0, eligible: 0, queued: 0 }
        const input = await profileInputs(tx, ownerUserId)
        if (!input) return { considered: 0, eligible: 0, queued: 0 }
        await tx.discoveryAllowance.upsert({
          where: { ownerUserId_periodStart: { ownerUserId, periodStart } },
          create: { ownerUserId, periodStart, scans: 1 },
          update: { scans: { increment: 1 }, lastScannedAt: new Date() },
        })
        const watched = await tx.companyWatch.findMany({
          where: { ownerUserId },
          orderBy: { boardId: "asc" },
          take: entitlement.limits.watches,
        })
        const scanKey = fingerprint([
          input.version.id,
          input.profile.preferenceRevision,
          input.preferenceHash,
          watched.map((w) => w.boardId),
          ALGORITHM_VERSION,
        ])
        const cursor =
          input.profile.discoveryInputKey === scanKey
            ? input.profile.discoveryCursor
            : null
        const page = await tx.jobPosting.findMany({
          where: {
            open: true,
            boardId: { in: watched.map((w) => w.boardId) },
            ...(cursor ? { id: { gt: cursor } } : {}),
            board: { enabled: true, watches: { some: { ownerUserId } } },
          },
          orderBy: { id: "asc" },
          take: 3001,
        })
        const postings = page.slice(0, 3000)
        await tx.userProfile.update({
          where: { id: ownerUserId },
          data: {
            discoveryInputKey: scanKey,
            discoveryCursor: page.length > 3000 ? postings.at(-1)!.id : null,
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
        const [counts] = await tx.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM "ProcessingRun" WHERE "ownerUserId" = ${ownerUserId} AND kind = ${MATCH_KIND} AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
        let remaining = Math.max(0, MAX_AI_PER_USER_DAY - Number(counts.count)),
          queued = 0
        for (const { posting, result } of ranked.slice(
          0,
          MAX_FEED_CANDIDATES
        )) {
          const inputKey = fingerprint([
            ownerUserId,
            input.version.id,
            input.profile.preferenceRevision,
            input.preferenceHash,
            posting.id,
            posting.contentVersion,
            posting.contentHash,
            ALGORITHM_VERSION,
          ])
          const match = await tx.jobMatch.upsert({
            where: { inputKey },
            create: {
              ownerUserId,
              resumeId: input.resume.id,
              resumeVersionId: input.version.id,
              preferenceRevision: input.profile.preferenceRevision,
              preferenceHash: input.preferenceHash,
              jobPostingId: posting.id,
              postingVersion: posting.contentVersion,
              postingHash: posting.contentHash,
              algorithmVersion: ALGORITHM_VERSION,
              inputKey,
              relevance: result.score,
              reasons: result.reasons,
            },
            update: {},
          })
          if (remaining && !match.aiAnalyzedAt) {
            const state = await tx.userJobState.findUnique({
              where: {
                ownerUserId_jobPostingId: {
                  ownerUserId,
                  jobPostingId: posting.id,
                },
              },
            })
            if (state?.state === "dismissed") continue
            const key = `user:${ownerUserId}:match:${inputKey}`
            if (
              !(await tx.processingRun.findUnique({
                where: { idempotencyKey: key },
              }))
            ) {
              await tx.processingRun.create({
                data: {
                  ownerUserId,
                  kind: MATCH_KIND,
                  resourceId: match.id,
                  idempotencyKey: key,
                },
              })
              remaining--
              queued++
            }
          }
        }
        return {
          considered: postings.length,
          eligible: ranked.length,
          surfaced: Math.min(ranked.length, MAX_FEED_CANDIDATES),
          queued,
        }
      },
      { timeout: 60_000 }
    )
  }
  async function currentInputs(
    tx: Prisma.TransactionClient,
    run: ProcessingRun
  ) {
    if (!run.ownerUserId) return null
    const match = await tx.jobMatch.findFirst({
      where: { id: run.resourceId, ownerUserId: run.ownerUserId },
      include: { posting: { include: { board: true } } },
    })
    const input = await profileInputs(tx, run.ownerUserId)
    if (
      !match ||
      !input ||
      match.aiAnalyzedAt ||
      match.resumeVersionId !== input.version.id ||
      match.preferenceRevision !== input.profile.preferenceRevision ||
      match.preferenceHash !== input.preferenceHash ||
      match.postingVersion !== match.posting.contentVersion ||
      match.postingHash !== match.posting.contentHash ||
      !match.posting.open ||
      !match.posting.board.enabled ||
      match.algorithmVersion !== ALGORITHM_VERSION ||
      !(await tx.companyWatch.findUnique({
        where: {
          ownerUserId_boardId: {
            ownerUserId: run.ownerUserId,
            boardId: match.posting.boardId,
          },
        },
      }))
    )
      return null
    return { match, input }
  }
  async function processMatch(id: string | null = null) {
    const run = await runs.claim(MATCH_KIND, id)
    if (!run) return "not_claimed"
    let result: MatchResult | null = null,
      requestId: string | null = null
    try {
      const context = await db.$transaction((tx) => currentInputs(tx, run), {
        isolationLevel: "RepeatableRead",
      })
      if (!context) return runs.finish(run, "canceled", "inputs_stale")
      const prior = await db.aiUsageReservation.findUnique({
        where: { idempotencyKey: run.idempotencyKey },
        include: { usage: true },
      })
      if (prior?.usage.length)
        return runs.finish(run, "failed", "provider_outcome_unknown")
      const reservation = await accounting.reserve(run)
      await runs.renew(run)
      const usage = await accounting.begin(run, reservation.id)
      requestId = usage.requestId
      const { summary, skills, employment, education, credentials } =
        context.input.content
      const resume = { summary, skills, employment, education, credentials }
      result = await matcher(
        {
          resume,
          targets: context.input.targets.map((t) => ({
            targetTitle: t.targetTitle,
            keywords: t.keywords,
          })),
          posting: {
            title: context.match.posting.title,
            description: context.match.posting.description,
          },
        },
        (receipt) => accounting.capture(requestId!, receipt)
      )
      result = { ...result, retryable: false }
      if (result.data) {
        const parsed = matchSchema.safeParse(result.data)
        if (!parsed.success)
          result = { ...result, data: null, errorCode: "invalid_model_output" }
      }
      await db.$transaction(async (tx) => {
        await lockLiveRun(tx, run)
        await accounting.record(tx, requestId!, result!)
        // Fence profile changes and public posting updates during product commit.
        await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${run.ownerUserId} FOR NO KEY UPDATE`
        await tx.$queryRaw`SELECT id FROM "JobPosting" WHERE id = ${context.match.jobPostingId}::uuid FOR SHARE`
        const valid = await currentInputs(tx, run)
        if (valid && result!.data)
          await tx.jobMatch.update({
            where: { id: valid.match.id },
            data: {
              aiScore: result!.data.score,
              recommendation: result!.data.recommendation,
              rationale: result!.data.rationale,
              aiAnalyzedAt: new Date(),
            },
          })
        await tx.processingRun.update({
          where: { id: run.id },
          data: {
            status: !valid ? "canceled" : result!.data ? "succeeded" : "failed",
            errorCode: !valid ? "inputs_stale" : result!.errorCode,
            completedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
      })
      return result.data ? "succeeded" : "failed"
    } catch (error) {
      if (requestId && result)
        await db.$transaction((tx) =>
          accounting.record(tx, requestId!, result!)
        )
      if (error instanceof LostLeaseError) return "lost_lease"
      if (
        error instanceof AllowanceError &&
        error.code === "daily_match_limit"
      ) {
        await db.$transaction(async (tx) => {
          await lockLiveRun(tx, run)
          await tx.$executeRaw`UPDATE "ProcessingRun" SET status='retry_wait', "availableAt"=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC',
            "leaseToken"=NULL,"leaseExpiresAt"=NULL,"errorCode"='daily_match_limit',"updatedAt"=now()
            WHERE id=${run.id}::uuid`
        })
        return "retry_wait"
      }
      return runs
        .finish(
          run,
          "failed",
          error instanceof AllowanceError
            ? error.code
            : requestId
              ? "provider_outcome_unknown"
              : "dependency_unavailable"
        )
        .catch((e) => {
          if (e instanceof LostLeaseError) return "lost_lease"
          throw e
        })
    }
  }
  async function recover() {
    const due = await db.atsBoard.findMany({
      where: {
        enabled: true,
        nextFetchAt: { lte: new Date() },
        watches: { some: {} },
      },
      orderBy: [{ nextFetchAt: "asc" }, { id: "asc" }],
      take: 3,
    })
    for (const board of due) await ensureBoard(board.id)
    let ingested = 0
    for (let n = 0; n < 3; n++) {
      if ((await ingest()) === "not_claimed") break
      ingested++
    }
    // Round-robin profile planning via last completed planning run. Database
    // history provides fairness across invocations without a volatile cursor.
    const owners = await db.$queryRaw<
      { id: string }[]
    >`SELECT u.id FROM "UserProfile" u WHERE u."deletionRequestedAt" IS NULL AND u."onboardingCompletedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "CompanyWatch" w WHERE w."ownerUserId" = u.id)
      ORDER BY (SELECT max(r."createdAt") FROM "ProcessingRun" r WHERE r."ownerUserId" = u.id AND kind = 'discovery_plan_v1') ASC NULLS FIRST, u.id LIMIT 10`
    const funnels = []
    for (const owner of owners) {
      funnels.push(await plan(owner.id))
      await db.$executeRaw`INSERT INTO "ProcessingRun" (id,"ownerUserId",kind,"resourceId","idempotencyKey",status,"completedAt","updatedAt")
        SELECT ${randomUUID()}::uuid,${owner.id},'discovery_plan_v1',${owner.id},${`plan:${owner.id}:${randomUUID()}`},'succeeded',now(),now()
        WHERE EXISTS (SELECT 1 FROM "UserProfile" WHERE id=${owner.id} AND "deletionRequestedAt" IS NULL)`
    }
    let matched = 0
    for (let n = 0; n < 2; n++) {
      if ((await processMatch()) === "not_claimed") break
      matched++
    }
    return { ingested, planned: owners.length, funnels, matched }
  }
  return { ensureBoard, ingest, plan, processMatch, recover }
}
