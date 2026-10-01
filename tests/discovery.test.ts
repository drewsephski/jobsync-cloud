import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createDiscoveryWorker, INGEST_KIND, MATCH_KIND } from "../lib/domain/discovery/worker"
import { createDiscoveryService } from "../lib/domain/discovery/service"
import { prerank, MAX_AI_PER_USER_DAY } from "../lib/domain/discovery/relevance"
import type { CanonicalJob } from "../lib/domain/discovery/providers"
import type { Matcher } from "../lib/ai/matching"
import type { CurrentAuthUser } from "../lib/auth/session-context"

nextEnv.loadEnvConfig(process.cwd())
const db = createDatabaseClient(process.env.DATABASE_URL!)
after(() => db.$disconnect())
const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const resumeData = (skill: string, privateValue: string) => ({
  contact: { name: "Test User", email: privateValue, phone: null, location: "Seattle", links: [] },
  summary: `${skill} professional`, skills: [skill],
  employment: [{ employer: "Example", title: `${skill} Engineer`, location: "Seattle", startDate: "2020", endDate: null, highlights: [`Built ${skill} systems`], evidence: `${skill} Engineer Built ${skill} systems` }],
  education: [], credentials: [],
})
function job(externalId: string, title: string, location: string, description: string): CanonicalJob {
  const contentHash = sha(`${externalId}:${title}:${location}:${description}`)
  return { externalId, title, location, remote: false, description, originalUrl: `https://boards.greenhouse.io/example/jobs/${externalId}`, publishedAt: new Date("2026-09-01T12:00:00Z"), contentHash }
}

test("real Postgres: shared ingestion, private matching, stale inputs, idempotency and closure", async () => {
  const suffix = randomUUID()
  const owners = [`discovery-a-${suffix}`, `discovery-b-${suffix}`]
  const companySlug = `discovery-test-${suffix}`
  const providerCalls: CanonicalJob[][] = [[
    job("se-1", "Senior Software Engineer", "Seattle, WA", "Build TypeScript APIs with PostgreSQL."),
    job("ds-1", "Data Scientist", "Seattle, WA", "Analyze machine learning datasets using Python."),
    job("other-1", "Office Manager", "Seattle, WA", "Manage office operations."),
    job("remote-1", "Software Engineer", "Remote", "Build distributed JavaScript services."),
    job("se-2", "Software Engineer II", "Seattle, WA", "Build TypeScript systems."),
    job("se-3", "Staff Software Engineer", "Seattle, WA", "Build PostgreSQL services."),
    job("se-4", "Backend Software Engineer", "Seattle, WA", "Build TypeScript APIs."),
    job("ds-2", "Senior Data Scientist", "Seattle, WA", "Build Python machine learning models."),
  ], [], []]
  let fetchCount = 0
  const matcherInputs: unknown[] = []
  let matcherCalls = 0
  const matcher: Matcher = async (input, onReceipt) => {
    matcherCalls++
    matcherInputs.push(input)
    const receipt = { model: "openai/gpt-6-luna", provider: "openrouter", providerRequestId: `test-${matcherCalls}`, inputTokens: 100, outputTokens: 30, totalTokens: 130, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: BigInt(25), actualCostUsd: 0.000025, latencyMs: 7, finishReason: "stop" }
    await onReceipt?.(receipt)
    return { data: { score: 88, recommendation: "strong", rationale: "The role matches the confirmed experience." }, receipt, errorCode: null, retryable: false, definitelyUnbilled: false }
  }
  await db.userProfile.createMany({ data: owners.map((id) => ({ id, onboardingCompletedAt: new Date(), preferenceRevision: 1 })) })
  let companyId: string | null = null
  let boardId: string | null = null
  let scanBoardId: string | null = null
  try {
    const company = await db.company.create({ data: { name: "Discovery Test Company", slug: companySlug } })
    companyId = company.id
    const board = await db.atsBoard.create({ data: { companyId, provider: "greenhouse", slug: `test-${suffix}`, nextFetchAt: new Date(Date.now() - 1000) } })
    boardId = board.id
    const fixtureBoardId = board.id
    await db.companyWatch.createMany({ data: owners.map((ownerUserId) => ({ ownerUserId, boardId: fixtureBoardId })) })

    const resumeIds: string[] = []
    for (const [index, ownerUserId] of owners.entries()) {
      const resume = await db.resume.create({ data: { ownerUserId, title: "Confirmed resume" } })
      resumeIds.push(resume.id)
      const data = resumeData(index === 0 ? "TypeScript" : "Python", `private-${index}@example.test`)
      const version = await db.resumeVersion.create({ data: { ownerUserId, resumeId: resume.id, version: 1, source: "manual", status: "ready", data } })
      await db.resume.update({ where: { id: resume.id }, data: { confirmedVersionId: version.id, confirmedAt: new Date() } })
      await db.targetPreference.create({ data: { ownerUserId, targetTitle: index === 0 ? "Software Engineer" : "Data Scientist", location: "Seattle", remotePreferred: false, keywords: [index === 0 ? "TypeScript" : "Python"] } })
    }
    // A newer, unconfirmed draft must never enter the matching input.
    await db.resumeVersion.create({ data: { ownerUserId: owners[0], resumeId: resumeIds[0], version: 2, source: "manual", status: "draft", data: resumeData("SECRET-DRAFT", "draft-private@example.test") } })
    const worker = createDiscoveryWorker(db, matcher, async () => {
      const snapshot = providerCalls[Math.min(fetchCount, providerCalls.length - 1)]
      fetchCount++
      return snapshot
    })

    const [queuedA, queuedB] = await Promise.all([worker.ensureBoard(boardId), worker.ensureBoard(boardId)])
    assert.ok(queuedA && queuedB)
    assert.equal(queuedA.id, queuedB.id, "parallel watchers share one idempotent ingestion run")
    assert.equal(await worker.ingest(queuedA.id), "succeeded")
    assert.equal(fetchCount, 1, "one shared fetch serves both owners")
    assert.equal(await db.jobPosting.count({ where: { boardId } }), 8, "postings are stored once globally")
    assert.equal(await worker.ensureBoard(boardId), null, "fresh boards are not fetched again")

    const se = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "se-1" } })
    const ds = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "ds-1" } })
    const irrelevant = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "other-1" } })
    const remote = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "remote-1" } })
    const ds2 = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "ds-2" } })
    const prefsA = await db.targetPreference.findMany({ where: { ownerUserId: owners[0] } })
    const confirmed = resumeData("TypeScript", "private-0@example.test")
    assert.equal(prerank(irrelevant, prefsA, confirmed).eligible, false)
    assert.equal(prerank(remote, [{ ...prefsA[0], location: "Seattle", remotePreferred: false }], confirmed).eligible, false)

    // Persist private actions before matching; dismissed work is never sent to AI.
    await db.userJobState.create({ data: { ownerUserId: owners[0], jobPostingId: se.id, state: "saved" } })
    await db.userJobState.create({ data: { ownerUserId: owners[1], jobPostingId: ds.id, state: "dismissed" } })
    const [planA, planB] = await Promise.all(owners.map((owner) => worker.plan(owner)))
    assert.equal(planA.eligible, 4)
    assert.equal(planB.eligible, 2)
    assert.equal(planA.queued, MAX_AI_PER_USER_DAY, "deterministic candidates are capped before AI dispatch")
    assert.equal(planB.queued, 1)
    assert.equal((await worker.plan(owners[0])).queued, 0, "repeated planning does not duplicate match runs")
    assert.ok(MAX_AI_PER_USER_DAY >= 1)
    const ownerAMatch = await db.jobMatch.findFirstOrThrow({ where: { ownerUserId: owners[0], jobPostingId: se.id } })
    const ownerBMatch = await db.jobMatch.findFirstOrThrow({ where: { ownerUserId: owners[1], jobPostingId: ds2.id } })
    assert.equal(await db.jobMatch.count({ where: { ownerUserId: owners[0], jobPostingId: ds.id } }), 0)
    assert.equal(await db.jobMatch.count({ where: { ownerUserId: owners[1], jobPostingId: se.id } }), 0)

    const discovery = createDiscoveryService(db)
    const authA = { id: owners[0], name: null, email: null } as CurrentAuthUser
    const authB = { id: owners[1], name: null, email: null } as CurrentAuthUser
    const matchRun = await db.processingRun.findUniqueOrThrow({ where: { idempotencyKey: `user:${owners[0]}:match:${ownerAMatch.inputKey}` } })
    const duplicateWork = await Promise.all([worker.processMatch(matchRun.id), worker.processMatch(matchRun.id)])
    assert.equal(duplicateWork.filter((value) => value === "succeeded").length, 1)
    assert.equal(matcherCalls, 1)
    const aiMatches = await db.jobMatch.findUniqueOrThrow({ where: { id: ownerAMatch.id } })
    assert.equal(aiMatches.aiScore, 88)
    assert.equal(JSON.stringify(matcherInputs).includes("SECRET-DRAFT"), false)
    assert.equal(JSON.stringify(matcherInputs).includes("private-0@example.test"), false, "contact data is removed")
    assert.equal(await db.aiUsageReservation.count({ where: { ownerUserId: owners[0] } }), 1)
    assert.equal(await db.aiUsage.count({ where: { ownerUserId: owners[0], status: "succeeded" } }), 1)
    assert.equal(await worker.processMatch(matchRun.id), "not_claimed")

    // Previous-day pending work remains eligible for planning, but current-day
    // usage is checked again atomically immediately before a provider call.
    const oldPending = await db.processingRun.findMany({ where: { ownerUserId: owners[0], kind: MATCH_KIND, status: "pending" } })
    assert.ok(oldPending.length >= 2)
    await db.processingRun.updateMany({ where: { id: { in: oldPending.map((r) => r.id) } }, data: { createdAt: new Date(Date.now() - 86_400_000) } })
    assert.equal((await worker.plan(owners[0])).queued, 1, "yesterday's queued runs do not consume today's planning allowance")
    const syntheticUsage = await db.aiUsage.createManyAndReturn({ data: [0, 1].map(() => ({ ownerUserId: owners[0], feature: MATCH_KIND, provider: "openrouter", model: "openai/gpt-6-luna", requestId: randomUUID(), status: "succeeded" as const, costMicroUsd: BigInt(1) })) })
    const limitedRun = await db.processingRun.findFirstOrThrow({ where: { ownerUserId: owners[0], kind: "job_match_v1", status: "pending" } })
    assert.equal(await worker.processMatch(limitedRun.id), "retry_wait")
    assert.equal(matcherCalls, 1, "daily cap rejects dispatch before the matcher is called")
    assert.equal((await db.processingRun.findUniqueOrThrow({ where: { id: limitedRun.id } })).errorCode, "daily_match_limit")

    // A posting edited during inference cannot receive the old version's AI result.
    await db.aiUsage.updateMany({ where: { id: { in: syntheticUsage.map((u) => u.id) } }, data: { createdAt: new Date(Date.now() - 86_400_000) } })
    const postingRun = await db.processingRun.findFirstOrThrow({ where: { ownerUserId: owners[0], kind: MATCH_KIND, status: "pending", id: { not: limitedRun.id } } })
    const postingMatch = await db.jobMatch.findUniqueOrThrow({ where: { id: postingRun.resourceId } })
    const posting = await db.jobPosting.findUniqueOrThrow({ where: { id: postingMatch.jobPostingId } })
    await db.userJobState.upsert({ where: { ownerUserId_jobPostingId: { ownerUserId: owners[0], jobPostingId: posting.id } }, create: { ownerUserId: owners[0], jobPostingId: posting.id, state: "saved" }, update: { state: "saved" } })
    let enteredMatcher!: () => void
    let releaseMatcher!: () => void
    const entered = new Promise<void>((resolve) => { enteredMatcher = resolve })
    const gate = new Promise<void>((resolve) => { releaseMatcher = resolve })
    const delayedMatcher: Matcher = async (_input, onReceipt) => {
      enteredMatcher()
      await gate
      const receipt = { model: "openai/gpt-6-luna", provider: "openrouter", providerRequestId: `delayed-${randomUUID()}`, inputTokens: 100, outputTokens: 30, totalTokens: 130, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: BigInt(25), actualCostUsd: 0.000025, latencyMs: 12, finishReason: "stop" }
      await onReceipt?.(receipt)
      return { data: { score: 91, recommendation: "strong", rationale: "A delayed result for a posting that changed." }, receipt, errorCode: null, retryable: false, definitelyUnbilled: false }
    }
    const postingWorker = createDiscoveryWorker(db, delayedMatcher)
    const postingWork = postingWorker.processMatch(postingRun.id)
    await entered
    await db.jobPosting.update({ where: { id: posting.id }, data: { description: "Revised job requirements.", contentHash: sha("revised job requirements"), contentVersion: { increment: 1 } } })
    releaseMatcher()
    await postingWork
    assert.equal((await db.processingRun.findUniqueOrThrow({ where: { id: postingRun.id } })).status, "canceled")
    assert.equal((await db.jobMatch.findUniqueOrThrow({ where: { id: postingMatch.id } })).aiScore, null)
    const savedBeforePreferenceChange = await discovery.read(authA, "", "saved")
    const stalePostingCard = savedBeforePreferenceChange.jobs.find((j) => j.id === posting.id)
    assert.equal(stalePostingCard?.stale, true)
    assert.equal(stalePostingCard?.aiScore, null)
    assert.equal(savedBeforePreferenceChange.jobs.find((j) => j.id === se.id)?.aiScore, 88)

    // A changed preference revision invalidates unprocessed matches at dispatch.
    await db.userProfile.update({ where: { id: owners[1] }, data: { preferenceRevision: 2 } })
    const staleRun = await db.processingRun.findUniqueOrThrow({ where: { idempotencyKey: `user:${owners[1]}:match:${ownerBMatch.inputKey}` } })
    assert.equal(await worker.processMatch(staleRun.id), "canceled")
    await db.userProfile.update({ where: { id: owners[0] }, data: { preferenceRevision: 2 } })
    const savedAfterPreferenceChange = await discovery.read(authA, "", "saved")
    const staleSavedCard = savedAfterPreferenceChange.jobs.find((j) => j.id === se.id)
    assert.equal(staleSavedCard?.state, "saved", "saved state survives preference revisions")
    assert.equal(staleSavedCard?.stale, true)
    assert.equal(staleSavedCard?.aiScore, null, "a stale AI score is hidden")
    const dismissedAfterPreferenceChange = await discovery.read(authB, "", "dismissed")
    const staleDismissedCard = dismissedAfterPreferenceChange.jobs.find((j) => j.id === ds.id)
    assert.equal(staleDismissedCard?.state, "dismissed", "dismissed state survives preference revisions")
    assert.equal(staleDismissedCard?.stale, true)
    assert.equal(staleDismissedCard?.aiScore, null)

    // A confirmed resume change during inference also invalidates the result at commit.
    assert.equal((await worker.plan(owners[1])).queued, 1)
    const refreshedOwnerBMatch = await db.jobMatch.findFirstOrThrow({ where: { ownerUserId: owners[1], jobPostingId: ds2.id, preferenceRevision: 2 } })
    const resumeRun = await db.processingRun.findUniqueOrThrow({ where: { idempotencyKey: `user:${owners[1]}:match:${refreshedOwnerBMatch.inputKey}` } })
    let resumeEntered!: () => void
    let releaseResume!: () => void
    const resumeStarted = new Promise<void>((resolve) => { resumeEntered = resolve })
    const resumeGate = new Promise<void>((resolve) => { releaseResume = resolve })
    const resumeMatcher: Matcher = async (_input, onReceipt) => {
      resumeEntered()
      await resumeGate
      const receipt = { model: "openai/gpt-6-luna", provider: "openrouter", providerRequestId: `resume-${randomUUID()}`, inputTokens: 100, outputTokens: 25, totalTokens: 125, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: BigInt(20), actualCostUsd: 0.00002, latencyMs: 10, finishReason: "stop" }
      await onReceipt?.(receipt)
      return { data: { score: 75, recommendation: "possible", rationale: "A delayed result for an older resume." }, receipt, errorCode: null, retryable: false, definitelyUnbilled: false }
    }
    const resumeWork = createDiscoveryWorker(db, resumeMatcher).processMatch(resumeRun.id)
    await resumeStarted
    const ownerBResume = await db.resume.findFirstOrThrow({ where: { ownerUserId: owners[1] } })
    const changedResume = await db.resumeVersion.create({ data: { ownerUserId: owners[1], resumeId: ownerBResume.id, version: 2, source: "manual", status: "ready", data: resumeData("Python and distributed systems", "private-1@example.test") } })
    await db.resume.update({ where: { id: ownerBResume.id }, data: { confirmedVersionId: changedResume.id, confirmedAt: new Date() } })
    releaseResume()
    await resumeWork
    assert.equal((await db.processingRun.findUniqueOrThrow({ where: { id: resumeRun.id } })).status, "canceled")
    assert.equal((await db.jobMatch.findUniqueOrThrow({ where: { id: refreshedOwnerBMatch.id } })).aiScore, null)
    // Ingest changed posting content to produce a new content version and match identity.
    await db.atsBoard.update({ where: { id: boardId }, data: { nextFetchAt: new Date(Date.now() - 1000) } })
    const changed = [job("se-1", "Senior Software Engineer", "Seattle, WA", "Build TypeScript and secure PostgreSQL APIs."), ...providerCalls[0].slice(1)]
    const reingest = createDiscoveryWorker(db, matcher, async () => { fetchCount++; return changed })
    const changedRun = await reingest.ensureBoard(boardId)
    assert.ok(changedRun)
    assert.equal(await reingest.ingest(changedRun.id), "succeeded")
    const updatedSe = await db.jobPosting.findFirstOrThrow({ where: { boardId, externalId: "se-1" } })
    assert.equal(updatedSe.contentVersion, 2)
    const refreshed = await worker.plan(owners[0])
    assert.equal(refreshed.eligible, 4)
    assert.equal(await db.jobMatch.count({ where: { ownerUserId: owners[0], jobPostingId: se.id } }), 2, "changed posting content creates a new immutable input match")

    const scanBoard = await db.atsBoard.create({ data: { companyId, provider: "greenhouse", slug: `scan-${suffix}` } })
    scanBoardId = scanBoard.id
    await db.companyWatch.create({ data: { ownerUserId: owners[0], boardId: scanBoard.id } })
    const fillers = Array.from({ length: 3001 }, (_, index) => {
      const sequence = (index + 1).toString(16).padStart(12, "0")
      const id = `00000000-0000-4000-8000-${sequence}`
      return { id, boardId: scanBoard.id, externalId: `unrelated-${index + 1}`, title: "Office Assistant", location: "Seattle, WA", remote: false, description: "Manage office operations.", originalUrl: "https://boards.greenhouse.io/example/jobs/unrelated", contentHash: sha(`unrelated-${index + 1}`) }
    })
    for (let offset = 0; offset < fillers.length; offset += 500)
      await db.jobPosting.createMany({ data: fillers.slice(offset, offset + 500) })
    const latePostingId = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    await db.jobPosting.create({ data: { id: latePostingId, boardId: scanBoard.id, externalId: "late-relevant", title: "Senior Software Engineer", location: "Seattle, WA", remote: false, description: "Build TypeScript services.", originalUrl: "https://boards.greenhouse.io/example/jobs/late-relevant", contentHash: sha("late-relevant") } })
    const firstScan = await worker.plan(owners[0])
    assert.equal(firstScan.considered, 3000)
    assert.equal(firstScan.eligible, 0, "the initial bounded page contains only unrelated jobs")
    const firstCursor = await db.userProfile.findUniqueOrThrow({ where: { id: owners[0] } })
    assert.equal(firstCursor.discoveryCursor, fillers[2999].id)
    const firstInputKey = firstCursor.discoveryInputKey

    // Changing watched boards resets the cursor so the new input set is scanned from its start.
    await discovery.mutate(authA, { action: "watch", boardId: fixtureBoardId, watching: false })
    const restartedScan = await worker.plan(owners[0])
    assert.equal(restartedScan.considered, 3000)
    const restartedCursor = await db.userProfile.findUniqueOrThrow({ where: { id: owners[0] } })
    assert.equal(restartedCursor.discoveryCursor, fillers[2999].id)
    assert.notEqual(restartedCursor.discoveryInputKey, firstInputKey)
    const secondScan = await worker.plan(owners[0])
    assert.equal(secondScan.considered, 2, "the next call advances to the remainder of the catalog")
    assert.equal(secondScan.eligible, 1)
    assert.equal((await db.userProfile.findUniqueOrThrow({ where: { id: owners[0] } })).discoveryCursor, null)
    const lateMatch = await db.jobMatch.findFirstOrThrow({ where: { ownerUserId: owners[0], jobPostingId: latePostingId } })
    assert.equal(lateMatch.jobPostingId, latePostingId, "a relevant posting beyond the first 3000 is reached")
    await assert.rejects(
      db.jobMatch.update({ where: { id: lateMatch.id }, data: { preferenceRevision: { increment: 1 } } }),
      /immutable_match_inputs/
    )
    const savedAfterUnwatch = await discovery.read(authA, "", "saved")
    const savedWhileUnwatched = savedAfterUnwatch.jobs.find((j) => j.id === se.id)
    assert.equal(savedWhileUnwatched?.state, "saved", "saved history remains visible after unwatch")

    // Provider failures keep known postings; successful omissions require two snapshots to close history.
    await db.atsBoard.update({ where: { id: boardId }, data: { nextFetchAt: new Date(Date.now() - 1000) } })
    const outageWorker = createDiscoveryWorker(db, matcher, async () => { throw new Error("temporary provider outage") })
    const outageRun = await outageWorker.ensureBoard(boardId)
    assert.ok(outageRun)
    assert.notEqual(await outageWorker.ingest(outageRun.id), "succeeded")
    assert.equal((await db.jobPosting.findUniqueOrThrow({ where: { id: updatedSe.id } })).open, true)
    const emptyWorker = createDiscoveryWorker(db, matcher, async () => { fetchCount++; return [] })
    await db.processingRun.update({ where: { id: outageRun.id }, data: { status: "failed", attempt: 5, completedAt: new Date() } })
    await db.atsBoard.update({ where: { id: boardId }, data: { nextFetchAt: new Date(Date.now() - 1000) } })
    const countBeforeRotation = (await db.atsBoard.findUniqueOrThrow({ where: { id: boardId } })).fetchCount
    assert.equal(await emptyWorker.ensureBoard(boardId), null, "terminal board runs rotate to a later freshness generation")
    assert.equal((await db.atsBoard.findUniqueOrThrow({ where: { id: boardId } })).fetchCount, countBeforeRotation + 1)
    await db.atsBoard.update({ where: { id: boardId }, data: { nextFetchAt: new Date(Date.now() - 1000) } })
    const emptyRun1 = await emptyWorker.ensureBoard(boardId)
    assert.ok(emptyRun1)
    assert.notEqual(emptyRun1.id, outageRun.id, "the next scheduled attempt receives a fresh run")
    assert.equal(await emptyWorker.ingest(emptyRun1.id), "succeeded")
    assert.equal((await db.jobPosting.findUniqueOrThrow({ where: { id: updatedSe.id } })).open, true)
    await db.atsBoard.update({ where: { id: boardId }, data: { nextFetchAt: new Date(Date.now() - 1000) } })
    const emptyRun2 = await emptyWorker.ensureBoard(boardId)
    assert.ok(emptyRun2)
    assert.equal(await emptyWorker.ingest(emptyRun2.id), "succeeded")
    const closed = await db.jobPosting.findUniqueOrThrow({ where: { id: updatedSe.id } })
    assert.equal(closed.open, false)
    assert.ok(closed.closedAt)
    assert.equal(closed.contentVersion, 3)
    await discovery.mutate(authB, { action: "watch", boardId: fixtureBoardId, watching: false })
    const dismissedAfterUnwatch = await discovery.read(authB, "", "dismissed")
    assert.equal(dismissedAfterUnwatch.jobs.find((j) => j.id === ds.id)?.state, "dismissed", "dismissed history remains visible after unwatch")
  } finally {
    const runWhere = { OR: [{ ownerUserId: { in: owners } }, ...(boardId ? [{ resourceId: boardId, kind: INGEST_KIND }] : [])] }
    await db.aiUsage.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.aiUsageReservation.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.jobMatch.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.userJobState.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.processingRun.deleteMany({ where: runWhere })
    await db.companyWatch.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.targetPreference.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.resume.updateMany({ where: { ownerUserId: { in: owners } }, data: { confirmedVersionId: null, confirmedAt: null } })
    await db.resumeVersion.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.resume.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.userProfile.deleteMany({ where: { id: { in: owners } } })
    if (boardId) {
      await db.jobPosting.deleteMany({ where: { boardId } })
      await db.atsBoard.delete({ where: { id: boardId } })
    }
    if (scanBoardId) {
      await db.jobPosting.deleteMany({ where: { boardId: scanBoardId } })
      await db.atsBoard.delete({ where: { id: scanBoardId } })
    }
    if (companyId) await db.company.delete({ where: { id: companyId } })
  }
})
