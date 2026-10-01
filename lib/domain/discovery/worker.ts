import { discoveryEligibleOwner } from "../../billing/entitlements"
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
import { createDiscoveryPlanner } from "./planner"
import { warmBoardFilter, isWarmBoard, freshBoardFilter } from "./catalog"
export { profileInputs } from "./inputs"
import { fetchBoard } from "./providers"
import { ALGORITHM_VERSION } from "./relevance"
export const INGEST_KIND = "board_ingest_v1"
export const MATCH_KIND = "job_match_v1"
import { FRESHNESS_MS } from "./catalog"
export { FRESHNESS_MS } from "./catalog"
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
          OR: [
            warmBoardFilter(),
            { watches: { some: { owner: discoveryEligibleOwner() } } },
          ],
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
        (!isWarmBoard(board) &&
          !(await db.companyWatch.findFirst({
            where: { boardId: board.id, owner: discoveryEligibleOwner() },
          })))
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
  const plan = createDiscoveryPlanner(db)
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
      !match.posting.board.lastSuccessAt ||
      match.posting.board.lastSuccessAt < freshBoardFilter().lastSuccessAt.gte
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
        OR: [
          warmBoardFilter(),
          { watches: { some: { owner: discoveryEligibleOwner() } } },
        ],
      },
      orderBy: [{ nextFetchAt: "asc" }, { id: "asc" }],
      take: 3,
    })
    await Promise.all(due.map((board) => ensureBoard(board.id)))
    const ingestion = await Promise.all([ingest(), ingest()])
    if (ingestion.some((r) => r !== "not_claimed"))
      ingestion.push(await ingest())
    const ingested = ingestion.filter((r) => r !== "not_claimed").length
    // Round-robin profile planning via last completed planning run. Database
    // history provides fairness across invocations without a volatile cursor.
    const owners = await db.$queryRaw<
      { id: string }[]
    >`SELECT u.id FROM "UserProfile" u WHERE u."deletionRequestedAt" IS NULL AND u."onboardingCompletedAt" IS NOT NULL
      ORDER BY (SELECT max(r."createdAt") FROM "ProcessingRun" r WHERE r."ownerUserId" = u.id AND kind = 'discovery_plan_v1') ASC NULLS FIRST, u.id LIMIT 10`
    const funnels = []
    for (let offset = 0; offset < owners.length; offset += 2) {
      funnels.push(
        ...(await Promise.all(
          owners.slice(offset, offset + 2).map(async (owner) => {
            const funnel = await plan(owner.id, { incremental: true })
            if (!("latencyMs" in funnel))
              await db.$executeRaw`INSERT INTO "ProcessingRun" (id,"ownerUserId",kind,"resourceId","idempotencyKey",status,"completedAt","updatedAt")
        SELECT ${randomUUID()}::uuid,${owner.id},'discovery_plan_v1',${owner.id},${`plan:${owner.id}:${randomUUID()}`},'succeeded',now(),now()
        WHERE EXISTS (SELECT 1 FROM "UserProfile" WHERE id=${owner.id} AND "deletionRequestedAt" IS NULL)`
            return funnel
          })
        ))
      )
    }
    const matched = (
      await Promise.all([processMatch(), processMatch()])
    ).filter((r) => r !== "not_claimed").length
    return { ingested, planned: owners.length, funnels, matched }
  }
  async function wake(input: { ownerUserId?: string; boardId?: string }) {
    // Wakeups identify durable state; they never confer eligibility or ownership.
    const startedAt = Date.now()
    let ingested = "not_needed"
    if (input.boardId) {
      const run = await ensureBoard(input.boardId)
      if (run) ingested = await ingest(run.id)
      // The initiating watcher must never wait behind the fan-out batch limit.
      if (input.ownerUserId)
        await plan(input.ownerUserId, { boardId: input.boardId })
      // Monitoring improves every eligible watcher, even when their browser is
      // closed. Scheduled global planning repairs any remainder of this batch.
      const watchers = await db.companyWatch.findMany({
        where: {
          boardId: input.boardId,
          owner: discoveryEligibleOwner(),
          ...(input.ownerUserId
            ? { ownerUserId: { not: input.ownerUserId } }
            : {}),
        },
        select: { ownerUserId: true },
        orderBy: { ownerUserId: "asc" },
        take: input.ownerUserId ? 9 : 10,
      })
      for (let offset = 0; offset < watchers.length; offset += 2)
        await Promise.all(
          watchers
            .slice(offset, offset + 2)
            .map((watcher) =>
              plan(watcher.ownerUserId, { boardId: input.boardId })
            )
        )
    }
    if (input.ownerUserId) {
      if (!input.boardId) await plan(input.ownerUserId, { incremental: true })
      const pending = await db.processingRun.findMany({
        where: {
          ownerUserId: input.ownerUserId,
          kind: MATCH_KIND,
          status: { in: ["pending", "retry_wait"] },
          availableAt: { lte: new Date() },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 3,
      })
      const results = []
      for (
        let n = 0;
        n < pending.length && Date.now() - startedAt < 20_000;
        n += 2
      )
        results.push(
          ...(await Promise.all(
            pending.slice(n, n + 2).map((r) => processMatch(r.id))
          ))
        )
      return {
        ingested,
        matched: results.filter((r) => r !== "not_claimed").length,
      }
    }
    return { ingested, matched: 0 }
  }
  return { ensureBoard, ingest, plan, processMatch, recover, wake }
}
