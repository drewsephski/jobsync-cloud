import { trialFields } from "./billing-fixtures"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import {
  createDiscoveryWorker,
  INGEST_KIND,
  MATCH_KIND,
} from "../lib/domain/discovery/worker"
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
  contact: {
    name: "Test User",
    email: privateValue,
    phone: null,
    location: "Seattle",
    links: [],
  },
  summary: `${skill} professional`,
  skills: [skill],
  employment: [
    {
      employer: "Example",
      title: `${skill} Engineer`,
      location: "Seattle",
      startDate: "2020",
      endDate: null,
      highlights: [`Built ${skill} systems`],
      evidence: `${skill} Engineer Built ${skill} systems`,
    },
  ],
  education: [],
  credentials: [],
})

test("deterministic relevance rejects neighboring occupations with shared words", () => {
  const resume = resumeData("TypeScript", "private@example.test")
  const cases = [
    ["Product Manager", "Product Designer"],
    ["Software Sales", "Software Engineer"],
    ["Data Engineer", "Data Scientist"],
  ] as const
  for (const [targetTitle, postingTitle] of cases) {
    assert.equal(
      prerank(
        {
          title: postingTitle,
          location: "Seattle, WA",
          remote: false,
          description: "Build TypeScript systems.",
        },
        [
          {
            id: randomUUID(),
            ownerUserId: "relevance-test",
            createdAt: new Date(),
            updatedAt: new Date(),
            targetTitle,
            location: "Seattle",
            remotePreferred: false,
            keywords: [],
            minimumCompensationUsd: null,
            active: true,
          },
        ],
        resume
      ).eligible,
      false,
      `${postingTitle} should not match a ${targetTitle} target`
    )
  }
})
function job(
  externalId: string,
  title: string,
  location: string,
  description: string
): CanonicalJob {
  const contentHash = sha(`${externalId}:${title}:${location}:${description}`)
  return {
    externalId,
    title,
    location,
    remote: false,
    description,
    originalUrl: `https://boards.greenhouse.io/example/jobs/${externalId}`,
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    contentHash,
  }
}

test("real Postgres: shared ingestion, private matching, stale inputs, idempotency and closure", async () => {
  const suffix = randomUUID()
  const owners = [`discovery-a-${suffix}`, `discovery-b-${suffix}`]
  const companySlug = `discovery-test-${suffix}`
  const providerCalls: CanonicalJob[][] = [
    [
      job(
        "se-1",
        "Senior Software Engineer",
        "Seattle, WA",
        "Build TypeScript APIs with PostgreSQL."
      ),
      job(
        "ds-1",
        "Data Scientist",
        "Seattle, WA",
        "Analyze machine learning datasets using Python."
      ),
      job(
        "other-1",
        "Office Manager",
        "Seattle, WA",
        "Manage office operations."
      ),
      job(
        "remote-1",
        "Software Engineer",
        "Remote",
        "Build distributed JavaScript services."
      ),
      job(
        "se-2",
        "Software Engineer II",
        "Seattle, WA",
        "Build TypeScript systems."
      ),
      job(
        "se-3",
        "Staff Software Engineer",
        "Seattle, WA",
        "Build PostgreSQL services."
      ),
      job(
        "se-4",
        "Backend Software Engineer",
        "Seattle, WA",
        "Build TypeScript APIs."
      ),
      job(
        "ds-2",
        "Senior Data Scientist",
        "Seattle, WA",
        "Build Python machine learning models."
      ),
    ],
    [],
    [],
  ]
  let fetchCount = 0
  const matcherInputs: unknown[] = []
  let matcherCalls = 0
  const matcher: Matcher = async (input, onReceipt) => {
    matcherCalls++
    matcherInputs.push(input)
    const receipt = {
      model: "openai/gpt-6-luna",
      provider: "openrouter",
      providerRequestId: `test-${matcherCalls}`,
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      reasoningTokens: 0,
      cachedTokens: 0,
      costMicroUsd: BigInt(25),
      actualCostUsd: 0.000025,
      latencyMs: 7,
      finishReason: "stop",
    }
    await onReceipt?.(receipt)
    return {
      data: {
        score: 88,
        recommendation: "strong",
        rationale: "The role matches the confirmed experience.",
      },
      receipt,
      errorCode: null,
      retryable: false,
      definitelyUnbilled: false,
    }
  }
  await db.userProfile.createMany({
    data: owners.map((id) => ({
      id,
      ...trialFields(),
      onboardingCompletedAt: new Date(),
      preferenceRevision: 1,
    })),
  })
  let companyId: string | null = null
  let boardId: string | null = null
  let scanBoardId: string | null = null
  let cursorBoardId: string | null = null
  try {
    const company = await db.company.create({
      data: { name: "Discovery Test Company", slug: companySlug },
    })
    companyId = company.id
    const board = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: `test-${suffix}`,
        nextFetchAt: new Date(Date.now() - 1000),
      },
    })
    boardId = board.id
    const fixtureBoardId = board.id
    await db.companyWatch.createMany({
      data: owners.map((ownerUserId) => ({
        ownerUserId,
        boardId: fixtureBoardId,
      })),
    })

    const resumeIds: string[] = []
    for (const [index, ownerUserId] of owners.entries()) {
      const resume = await db.resume.create({
        data: { ownerUserId, title: "Confirmed resume" },
      })
      resumeIds.push(resume.id)
      const data = resumeData(
        index === 0 ? "TypeScript" : "Python",
        `private-${index}@example.test`
      )
      const version = await db.resumeVersion.create({
        data: {
          ownerUserId,
          resumeId: resume.id,
          version: 1,
          source: "manual",
          status: "ready",
          data,
        },
      })
      await db.resume.update({
        where: { id: resume.id },
        data: { confirmedVersionId: version.id, confirmedAt: new Date() },
      })
      await db.targetPreference.create({
        data: {
          ownerUserId,
          targetTitle: index === 0 ? "Software Engineer" : "Data Scientist",
          location: "Seattle",
          remotePreferred: false,
          keywords: [index === 0 ? "TypeScript" : "Python"],
        },
      })
    }
    // A newer, unconfirmed draft must never enter the matching input.
    await db.resumeVersion.create({
      data: {
        ownerUserId: owners[0],
        resumeId: resumeIds[0],
        version: 2,
        source: "manual",
        status: "draft",
        data: resumeData("SECRET-DRAFT", "draft-private@example.test"),
      },
    })
    const worker = createDiscoveryWorker(db, matcher, async () => {
      const snapshot =
        providerCalls[Math.min(fetchCount, providerCalls.length - 1)]
      fetchCount++
      return snapshot
    })

    const [queuedA, queuedB] = await Promise.all([
      worker.ensureBoard(boardId),
      worker.ensureBoard(boardId),
    ])
    assert.ok(queuedA && queuedB)
    assert.equal(
      queuedA.id,
      queuedB.id,
      "parallel watchers share one idempotent ingestion run"
    )
    assert.equal(await worker.ingest(queuedA.id), "succeeded")
    assert.equal(fetchCount, 1, "one shared fetch serves both owners")
    assert.equal(
      await db.jobPosting.count({ where: { boardId } }),
      8,
      "postings are stored once globally"
    )
    assert.equal(
      await worker.ensureBoard(boardId),
      null,
      "fresh boards are not fetched again"
    )

    const se = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "se-1" },
    })
    const ds = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "ds-1" },
    })
    const irrelevant = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "other-1" },
    })
    const remote = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "remote-1" },
    })
    const ds2 = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "ds-2" },
    })
    const prefsA = await db.targetPreference.findMany({
      where: { ownerUserId: owners[0] },
    })
    const confirmed = resumeData("TypeScript", "private-0@example.test")
    assert.equal(prerank(irrelevant, prefsA, confirmed).eligible, false)
    assert.equal(
      prerank(
        remote,
        [{ ...prefsA[0], location: "Seattle", remotePreferred: false }],
        confirmed
      ).eligible,
      false
    )

    // Persist private actions before matching; dismissed work is never sent to AI.
    await db.userJobState.create({
      data: { ownerUserId: owners[0], jobPostingId: se.id, state: "saved" },
    })
    await db.userJobState.create({
      data: { ownerUserId: owners[1], jobPostingId: ds.id, state: "dismissed" },
    })
    const [planA, planB] = await Promise.all(
      owners.map((owner) => worker.plan(owner))
    )
    assert.equal(planA.eligible, 4)
    assert.equal(planB.eligible, 2)
    assert.equal(
      planA.queued,
      MAX_AI_PER_USER_DAY,
      "deterministic candidates are capped before AI dispatch"
    )
    assert.equal(planB.queued, 1)
    assert.equal(
      (await worker.plan(owners[0])).queued,
      0,
      "repeated planning does not duplicate match runs"
    )
    assert.ok(MAX_AI_PER_USER_DAY >= 1)
    const ownerAMatch = await db.jobMatch.findFirstOrThrow({
      where: { ownerUserId: owners[0], jobPostingId: se.id },
    })
    const ownerBMatch = await db.jobMatch.findFirstOrThrow({
      where: { ownerUserId: owners[1], jobPostingId: ds2.id },
    })
    assert.equal(
      await db.jobMatch.count({
        where: { ownerUserId: owners[0], jobPostingId: ds.id },
      }),
      0
    )
    assert.equal(
      await db.jobMatch.count({
        where: { ownerUserId: owners[1], jobPostingId: se.id },
      }),
      0
    )

    const discovery = createDiscoveryService(db)
    const authA = { id: owners[0], name: null, email: null } as CurrentAuthUser
    const authB = { id: owners[1], name: null, email: null } as CurrentAuthUser
    const matchRun = await db.processingRun.findUniqueOrThrow({
      where: {
        idempotencyKey: `user:${owners[0]}:match:${ownerAMatch.inputKey}`,
      },
    })
    const duplicateWork = await Promise.all([
      worker.processMatch(matchRun.id),
      worker.processMatch(matchRun.id),
    ])
    assert.equal(
      duplicateWork.filter((value) => value === "succeeded").length,
      1
    )
    assert.equal(matcherCalls, 1)
    const aiMatches = await db.jobMatch.findUniqueOrThrow({
      where: { id: ownerAMatch.id },
    })
    assert.equal(aiMatches.aiScore, 88)
    assert.equal(JSON.stringify(matcherInputs).includes("SECRET-DRAFT"), false)
    assert.equal(
      JSON.stringify(matcherInputs).includes("private-0@example.test"),
      false,
      "contact data is removed"
    )
    assert.equal(
      await db.aiUsageReservation.count({ where: { ownerUserId: owners[0] } }),
      1
    )
    assert.equal(
      await db.aiUsage.count({
        where: { ownerUserId: owners[0], status: "succeeded" },
      }),
      1
    )
    assert.equal(await worker.processMatch(matchRun.id), "not_claimed")

    // Previous-day pending work remains eligible for planning, but current-day
    // usage is checked again atomically immediately before a provider call.
    const oldPending = await db.processingRun.findMany({
      where: { ownerUserId: owners[0], kind: MATCH_KIND, status: "pending" },
    })
    assert.ok(oldPending.length >= 2)
    await db.processingRun.updateMany({
      where: { id: { in: oldPending.map((r) => r.id) } },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    })
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    }) // Advance isolated scan admission for this lifecycle phase.
    assert.equal(
      (await worker.plan(owners[0])).queued,
      1,
      "yesterday's queued runs do not consume today's planning allowance"
    )
    const syntheticUsage = await db.aiUsage.createManyAndReturn({
      data: [0, 1].map(() => ({
        ownerUserId: owners[0],
        feature: MATCH_KIND,
        provider: "openrouter",
        model: "openai/gpt-6-luna",
        requestId: randomUUID(),
        status: "succeeded" as const,
        costMicroUsd: BigInt(1),
      })),
    })
    const limitedRun = await db.processingRun.findFirstOrThrow({
      where: {
        ownerUserId: owners[0],
        kind: "job_match_v1",
        status: "pending",
      },
    })
    assert.equal(await worker.processMatch(limitedRun.id), "retry_wait")
    assert.equal(
      matcherCalls,
      1,
      "daily cap rejects dispatch before the matcher is called"
    )
    assert.equal(
      (
        await db.processingRun.findUniqueOrThrow({
          where: { id: limitedRun.id },
        })
      ).errorCode,
      "daily_match_limit"
    )

    // A posting edited during inference cannot receive the old version's AI result.
    await db.aiUsage.updateMany({
      where: { id: { in: syntheticUsage.map((u) => u.id) } },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    })
    const postingRun = await db.processingRun.findFirstOrThrow({
      where: {
        ownerUserId: owners[0],
        kind: MATCH_KIND,
        status: "pending",
        id: { not: limitedRun.id },
      },
    })
    const postingMatch = await db.jobMatch.findUniqueOrThrow({
      where: { id: postingRun.resourceId },
    })
    const posting = await db.jobPosting.findUniqueOrThrow({
      where: { id: postingMatch.jobPostingId },
    })
    await db.userJobState.upsert({
      where: {
        ownerUserId_jobPostingId: {
          ownerUserId: owners[0],
          jobPostingId: posting.id,
        },
      },
      create: {
        ownerUserId: owners[0],
        jobPostingId: posting.id,
        state: "saved",
      },
      update: { state: "saved" },
    })
    let enteredMatcher!: () => void
    let releaseMatcher!: () => void
    const entered = new Promise<void>((resolve) => {
      enteredMatcher = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseMatcher = resolve
    })
    const delayedMatcher: Matcher = async (_input, onReceipt) => {
      enteredMatcher()
      await gate
      const receipt = {
        model: "openai/gpt-6-luna",
        provider: "openrouter",
        providerRequestId: `delayed-${randomUUID()}`,
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
        reasoningTokens: 0,
        cachedTokens: 0,
        costMicroUsd: BigInt(25),
        actualCostUsd: 0.000025,
        latencyMs: 12,
        finishReason: "stop",
      }
      await onReceipt?.(receipt)
      return {
        data: {
          score: 91,
          recommendation: "strong",
          rationale: "A delayed result for a posting that changed.",
        },
        receipt,
        errorCode: null,
        retryable: false,
        definitelyUnbilled: false,
      }
    }
    const postingWorker = createDiscoveryWorker(db, delayedMatcher)
    const postingWork = postingWorker.processMatch(postingRun.id)
    await entered
    await db.jobPosting.update({
      where: { id: posting.id },
      data: {
        description: "Revised job requirements.",
        contentHash: sha("revised job requirements"),
        contentVersion: { increment: 1 },
      },
    })
    releaseMatcher()
    await postingWork
    assert.equal(
      (
        await db.processingRun.findUniqueOrThrow({
          where: { id: postingRun.id },
        })
      ).status,
      "canceled"
    )
    assert.equal(
      (await db.jobMatch.findUniqueOrThrow({ where: { id: postingMatch.id } }))
        .aiScore,
      null
    )
    const savedBeforePreferenceChange = await discovery.read(authA, "", "saved")
    const stalePostingCard = savedBeforePreferenceChange.jobs.find(
      (j) => j.id === posting.id
    )
    assert.equal(stalePostingCard?.stale, true)
    assert.equal(stalePostingCard?.aiScore, null)
    assert.equal(
      savedBeforePreferenceChange.jobs.find((j) => j.id === se.id)?.aiScore,
      88
    )

    // A changed preference revision invalidates unprocessed matches at dispatch.
    await db.userProfile.update({
      where: { id: owners[1] },
      data: { preferenceRevision: 2 },
    })
    const staleRun = await db.processingRun.findUniqueOrThrow({
      where: {
        idempotencyKey: `user:${owners[1]}:match:${ownerBMatch.inputKey}`,
      },
    })
    assert.equal(await worker.processMatch(staleRun.id), "canceled")
    await db.userProfile.update({
      where: { id: owners[0] },
      data: { preferenceRevision: 2 },
    })
    const savedAfterPreferenceChange = await discovery.read(authA, "", "saved")
    const staleSavedCard = savedAfterPreferenceChange.jobs.find(
      (j) => j.id === se.id
    )
    assert.equal(
      staleSavedCard?.state,
      "saved",
      "saved state survives preference revisions"
    )
    assert.equal(staleSavedCard?.stale, true)
    assert.equal(staleSavedCard?.aiScore, null, "a stale AI score is hidden")
    const dismissedAfterPreferenceChange = await discovery.read(
      authB,
      "",
      "dismissed"
    )
    const staleDismissedCard = dismissedAfterPreferenceChange.jobs.find(
      (j) => j.id === ds.id
    )
    assert.equal(
      staleDismissedCard?.state,
      "dismissed",
      "dismissed state survives preference revisions"
    )
    assert.equal(staleDismissedCard?.stale, true)
    assert.equal(staleDismissedCard?.aiScore, null)

    // A confirmed resume change during inference also invalidates the result at commit.
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    }) // Advance isolated scan admission for this lifecycle phase.
    assert.equal((await worker.plan(owners[1])).queued, 1)
    const refreshedOwnerBMatch = await db.jobMatch.findFirstOrThrow({
      where: {
        ownerUserId: owners[1],
        jobPostingId: ds2.id,
        preferenceRevision: 2,
      },
    })
    const resumeRun = await db.processingRun.findUniqueOrThrow({
      where: {
        idempotencyKey: `user:${owners[1]}:match:${refreshedOwnerBMatch.inputKey}`,
      },
    })
    let resumeEntered!: () => void
    let releaseResume!: () => void
    const resumeStarted = new Promise<void>((resolve) => {
      resumeEntered = resolve
    })
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve
    })
    const resumeMatcher: Matcher = async (_input, onReceipt) => {
      resumeEntered()
      await resumeGate
      const receipt = {
        model: "openai/gpt-6-luna",
        provider: "openrouter",
        providerRequestId: `resume-${randomUUID()}`,
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        reasoningTokens: 0,
        cachedTokens: 0,
        costMicroUsd: BigInt(20),
        actualCostUsd: 0.00002,
        latencyMs: 10,
        finishReason: "stop",
      }
      await onReceipt?.(receipt)
      return {
        data: {
          score: 75,
          recommendation: "possible",
          rationale: "A delayed result for an older resume.",
        },
        receipt,
        errorCode: null,
        retryable: false,
        definitelyUnbilled: false,
      }
    }
    const resumeWork = createDiscoveryWorker(db, resumeMatcher).processMatch(
      resumeRun.id
    )
    await resumeStarted
    const ownerBResume = await db.resume.findFirstOrThrow({
      where: { ownerUserId: owners[1] },
    })
    const changedResume = await db.resumeVersion.create({
      data: {
        ownerUserId: owners[1],
        resumeId: ownerBResume.id,
        version: 2,
        source: "manual",
        status: "ready",
        data: resumeData(
          "Python and distributed systems",
          "private-1@example.test"
        ),
      },
    })
    await db.resume.update({
      where: { id: ownerBResume.id },
      data: { confirmedVersionId: changedResume.id, confirmedAt: new Date() },
    })
    releaseResume()
    await resumeWork
    assert.equal(
      (
        await db.processingRun.findUniqueOrThrow({
          where: { id: resumeRun.id },
        })
      ).status,
      "canceled"
    )
    assert.equal(
      (
        await db.jobMatch.findUniqueOrThrow({
          where: { id: refreshedOwnerBMatch.id },
        })
      ).aiScore,
      null
    )
    // Ingest changed posting content to produce a new content version and match identity.
    await db.atsBoard.update({
      where: { id: boardId },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const changed = [
      job(
        "se-1",
        "Senior Software Engineer",
        "Seattle, WA",
        "Build TypeScript and secure PostgreSQL APIs."
      ),
      ...providerCalls[0].slice(1),
    ]
    const reingest = createDiscoveryWorker(db, matcher, async () => {
      fetchCount++
      return changed
    })
    const changedRun = await reingest.ensureBoard(boardId)
    assert.ok(changedRun)
    assert.equal(await reingest.ingest(changedRun.id), "succeeded")
    const updatedSe = await db.jobPosting.findFirstOrThrow({
      where: { boardId, externalId: "se-1" },
    })
    assert.equal(updatedSe.contentVersion, 2)
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    }) // Advance isolated scan admission for this lifecycle phase.
    const refreshed = await worker.plan(owners[0])
    assert.equal(refreshed.eligible, 4)
    assert.equal(
      await db.jobMatch.count({
        where: { ownerUserId: owners[0], jobPostingId: se.id },
      }),
      2,
      "changed posting content creates a new immutable input match"
    )

    const scanBoard = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: `scan-${suffix}`,
        lastSuccessAt: new Date(),
      },
    })
    scanBoardId = scanBoard.id
    await db.companyWatch.create({
      data: { ownerUserId: owners[0], boardId: scanBoard.id },
    })
    const fillers = Array.from({ length: 3001 }, (_, index) => {
      const sequence = (index + 1).toString(16).padStart(12, "0")
      const id = `00000000-0000-4000-8000-${sequence}`
      return {
        id,
        boardId: scanBoard.id,
        externalId: `unrelated-${index + 1}`,
        title: "Office Assistant",
        location: "Seattle, WA",
        remote: false,
        description: "Manage office operations.",
        originalUrl: "https://boards.greenhouse.io/example/jobs/unrelated",
        contentHash: sha(`unrelated-${index + 1}`),
      }
    })
    for (let offset = 0; offset < fillers.length; offset += 500)
      await db.jobPosting.createMany({
        data: fillers.slice(offset, offset + 500),
      })
    const latePostingId = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    await db.jobPosting.create({
      data: {
        id: latePostingId,
        boardId: scanBoard.id,
        externalId: "late-relevant",
        title: "Senior Software Engineer",
        location: "Seattle, WA",
        remote: false,
        description: "Build TypeScript services.",
        originalUrl: "https://boards.greenhouse.io/example/jobs/late-relevant",
        contentHash: sha("late-relevant"),
      },
    })
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    }) // Advance isolated scan admission for this lifecycle phase.
    const firstScan = await worker.plan(owners[0])
    assert.ok(
      firstScan.considered < 3000,
      "title prefilter skips thousands of unrelated postings before the bounded scan"
    )
    assert.ok(firstScan.eligible >= 1)
    const lateMatch = await db.jobMatch.findFirstOrThrow({
      where: { ownerUserId: owners[0], jobPostingId: latePostingId },
    })
    assert.equal(
      lateMatch.jobPostingId,
      latePostingId,
      "the useful late posting is found in the first bounded scan"
    )

    // More than one page of title candidates still uses a durable rotating
    // cursor. These 3,001 postings pass the title prefilter but fail the user's
    // Seattle location rule, leaving the late Seattle posting on the next page.
    const cursorBoard = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: `cursor-${suffix}`,
        lastSuccessAt: new Date(),
      },
    })
    cursorBoardId = cursorBoard.id
    const cursorFillers = Array.from({ length: 3001 }, (_, index) => {
      const sequence = (index + 1).toString(16).padStart(12, "0")
      return {
        id: `00000001-0000-4000-8000-${sequence}`,
        boardId: cursorBoard.id,
        externalId: `cursor-${index + 1}`,
        title: "Software Engineer",
        location: "Denver, CO",
        remote: false,
        description: "Build TypeScript services.",
        originalUrl: "https://boards.greenhouse.io/example/jobs/cursor",
        contentHash: sha(`cursor-${index + 1}`),
      }
    })
    for (let offset = 0; offset < cursorFillers.length; offset += 500)
      await db.jobPosting.createMany({
        data: cursorFillers.slice(offset, offset + 500),
      })
    const cursorLateId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    await db.jobPosting.create({
      data: {
        id: cursorLateId,
        boardId: cursorBoard.id,
        externalId: "cursor-late-relevant",
        title: "Senior Software Engineer",
        location: "Seattle, WA",
        remote: false,
        description: "Build TypeScript services.",
        originalUrl: "https://boards.greenhouse.io/example/jobs/cursor-late",
        contentHash: sha("cursor-late-relevant"),
      },
    })
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    const cursorFirstScan = await worker.plan(owners[0])
    assert.equal(cursorFirstScan.considered, 3000)
    assert.equal(cursorFirstScan.eligible, 0)
    const firstCursor = await db.userProfile.findUniqueOrThrow({
      where: { id: owners[0] },
    })
    assert.equal(firstCursor.discoveryCursor, cursorFillers[2999].id)
    const firstInputKey = firstCursor.discoveryInputKey

    // A shared board refresh while a catalog sweep is in progress must not
    // reset it to page one. Finish the original input snapshot first.
    await db.atsBoard.update({
      where: { id: cursorBoard.id },
      data: { lastSuccessAt: new Date(Date.now() + 1000) },
    })

    // Watch changes do not narrow or reset shared-catalog coverage.
    await discovery.mutate(authA, {
      action: "watch",
      boardId: fixtureBoardId,
      watching: false,
    })
    const originalTail = await worker.plan(owners[0], { incremental: true })
    assert.ok(originalTail.considered < 10)
    assert.ok(originalTail.eligible >= 1)
    const restartedCursor = await db.userProfile.findUniqueOrThrow({
      where: { id: owners[0] },
    })
    assert.equal(restartedCursor.discoveryInputKey, firstInputKey)
    assert.equal(restartedCursor.discoveryCursor, null)

    // Only after the old cursor reaches its tail may an incremental sweep
    // capture the refreshed shared-catalog key and rotate through page one.
    const refreshedFirstPage = await worker.plan(owners[0], {
      incremental: true,
    })
    assert.equal(refreshedFirstPage.considered, 3000)
    const refreshedCursor = await db.userProfile.findUniqueOrThrow({
      where: { id: owners[0] },
    })
    assert.notEqual(refreshedCursor.discoveryInputKey, firstInputKey)
    assert.equal(refreshedCursor.discoveryCursor, cursorFillers[2999].id)
    const refreshedTail = await worker.plan(owners[0], { incremental: true })
    assert.ok(refreshedTail.considered < 10)
    const completedRefresh = await db.userProfile.findUniqueOrThrow({
      where: { id: owners[0] },
    })
    assert.equal(
      completedRefresh.discoveryInputKey,
      refreshedCursor.discoveryInputKey
    )
    assert.equal(completedRefresh.discoveryCursor, null)
    const cursorLateMatch = await db.jobMatch.findFirstOrThrow({
      where: { ownerUserId: owners[0], jobPostingId: cursorLateId },
    })
    assert.equal(
      cursorLateMatch.jobPostingId,
      cursorLateId,
      "the rotating scan eventually reaches a useful posting after 3,000 title candidates"
    )
    await assert.rejects(
      db.jobMatch.update({
        where: { id: lateMatch.id },
        data: { preferenceRevision: { increment: 1 } },
      }),
      /immutable_match_inputs/
    )
    const savedAfterUnwatch = await discovery.read(authA, "", "saved")
    const savedWhileUnwatched = savedAfterUnwatch.jobs.find(
      (j) => j.id === se.id
    )
    assert.equal(
      savedWhileUnwatched?.state,
      "saved",
      "saved history remains visible after unwatch"
    )

    // Provider failures keep known postings; successful omissions require two snapshots to close history.
    await db.atsBoard.update({
      where: { id: boardId },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const outageWorker = createDiscoveryWorker(db, matcher, async () => {
      throw new Error("temporary provider outage")
    })
    const outageRun = await outageWorker.ensureBoard(boardId)
    assert.ok(outageRun)
    assert.notEqual(await outageWorker.ingest(outageRun.id), "succeeded")
    assert.equal(
      (await db.jobPosting.findUniqueOrThrow({ where: { id: updatedSe.id } }))
        .open,
      true
    )
    const emptyWorker = createDiscoveryWorker(db, matcher, async () => {
      fetchCount++
      return []
    })
    await db.processingRun.update({
      where: { id: outageRun.id },
      data: { status: "failed", attempt: 5, completedAt: new Date() },
    })
    await db.atsBoard.update({
      where: { id: boardId },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const countBeforeRotation = (
      await db.atsBoard.findUniqueOrThrow({ where: { id: boardId } })
    ).fetchCount
    assert.equal(
      await emptyWorker.ensureBoard(boardId),
      null,
      "terminal board runs rotate to a later freshness generation"
    )
    assert.equal(
      (await db.atsBoard.findUniqueOrThrow({ where: { id: boardId } }))
        .fetchCount,
      countBeforeRotation + 1
    )
    await db.atsBoard.update({
      where: { id: boardId },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const emptyRun1 = await emptyWorker.ensureBoard(boardId)
    assert.ok(emptyRun1)
    assert.notEqual(
      emptyRun1.id,
      outageRun.id,
      "the next scheduled attempt receives a fresh run"
    )
    assert.equal(await emptyWorker.ingest(emptyRun1.id), "succeeded")
    assert.equal(
      (await db.jobPosting.findUniqueOrThrow({ where: { id: updatedSe.id } }))
        .open,
      true
    )
    await db.atsBoard.update({
      where: { id: boardId },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const emptyRun2 = await emptyWorker.ensureBoard(boardId)
    assert.ok(emptyRun2)
    assert.equal(await emptyWorker.ingest(emptyRun2.id), "succeeded")
    const closed = await db.jobPosting.findUniqueOrThrow({
      where: { id: updatedSe.id },
    })
    assert.equal(closed.open, false)
    assert.ok(closed.closedAt)
    assert.equal(closed.contentVersion, 3)
    await discovery.mutate(authB, {
      action: "watch",
      boardId: fixtureBoardId,
      watching: false,
    })
    const dismissedAfterUnwatch = await discovery.read(authB, "", "dismissed")
    assert.equal(
      dismissedAfterUnwatch.jobs.find((j) => j.id === ds.id)?.state,
      "dismissed",
      "dismissed history remains visible after unwatch"
    )
  } finally {
    const runWhere = {
      OR: [
        { ownerUserId: { in: owners } },
        ...(boardId ? [{ resourceId: boardId, kind: INGEST_KIND }] : []),
      ],
    }
    await db.aiUsage.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.aiUsageReservation.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.jobMatch.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.userJobState.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.processingRun.deleteMany({ where: runWhere })
    await db.companyWatch.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.targetPreference.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.resume.updateMany({
      where: { ownerUserId: { in: owners } },
      data: { confirmedVersionId: null, confirmedAt: null },
    })
    await db.resumeVersion.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.resume.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.userProfile.deleteMany({ where: { id: { in: owners } } })
    if (boardId) {
      await db.jobPosting.deleteMany({ where: { boardId } })
      await db.atsBoard.delete({ where: { id: boardId } })
    }
    if (scanBoardId) {
      await db.jobPosting.deleteMany({ where: { boardId: scanBoardId } })
      await db.atsBoard.delete({ where: { id: scanBoardId } })
    }
    if (cursorBoardId) {
      await db.jobPosting.deleteMany({ where: { boardId: cursorBoardId } })
      await db.atsBoard.delete({ where: { id: cursorBoardId } })
    }
    if (companyId) await db.company.delete({ where: { id: companyId } })
  }
})

test("real Postgres: first-use discovery works without watches and concurrent scans stay private", async () => {
  const suffix = randomUUID()
  const owners = [`first-use-a-${suffix}`, `first-use-b-${suffix}`]
  const companySlug = `first-use-${suffix}`
  let companyId: string | null = null
  let boardId: string | null = null
  let staleBoardId: string | null = null
  const resumeIds: string[] = []
  const fanoutOwners = Array.from(
    { length: 10 },
    (_, index) => `a-wake-${suffix}-${index.toString().padStart(2, "0")}`
  )
  await db.userProfile.createMany({
    data: owners.map((id) => ({
      id,
      ...trialFields(),
      onboardingCompletedAt: new Date(),
      preferenceRevision: 1,
    })),
  })
  try {
    const company = await db.company.create({
      data: { name: "First Use Shared Catalog", slug: companySlug },
    })
    companyId = company.id
    const board = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: "figma",
        nextFetchAt: new Date(Date.now() - 1000),
      },
    })
    boardId = board.id
    const staleBoard = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: `stale-first-use-${suffix}`,
        lastSuccessAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    })
    staleBoardId = staleBoard.id
    await db.jobPosting.create({
      data: {
        ...job(
          "stale-se-1",
          "Senior Software Engineer",
          "Seattle, WA",
          "Build TypeScript services."
        ),
        boardId: staleBoard.id,
      },
    })

    const postings = [
      ...Array.from({ length: 5 }, (_, index) =>
        job(
          `se-${index + 1}`,
          "Senior Software Engineer",
          "Seattle, WA",
          "Build TypeScript services for distributed systems."
        )
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        job(
          `ds-${index + 1}`,
          "Senior Data Scientist",
          "Seattle, WA",
          "Analyze Python datasets and machine learning models."
        )
      ),
    ]
    for (const [index, ownerUserId] of owners.entries()) {
      const skill = index === 0 ? "TypeScript" : "Python"
      const resume = await db.resume.create({
        data: { ownerUserId, title: "Confirmed first-use resume" },
      })
      resumeIds.push(resume.id)
      const version = await db.resumeVersion.create({
        data: {
          ownerUserId,
          resumeId: resume.id,
          version: 1,
          source: "manual",
          status: "ready",
          data: resumeData(skill, `${ownerUserId}@example.test`),
        },
      })
      await db.resume.update({
        where: { id: resume.id },
        data: { confirmedVersionId: version.id, confirmedAt: new Date() },
      })
      await db.targetPreference.create({
        data: {
          ownerUserId,
          targetTitle: index === 0 ? "Software Engineer" : "Data Scientist",
          location: "Seattle",
          remotePreferred: false,
          keywords: [skill],
        },
      })
    }

    const matcher: Matcher = async () => {
      throw new Error("deterministic planning must not call AI")
    }
    let fetchCount = 0
    const worker = createDiscoveryWorker(db, matcher, async () => {
      fetchCount++
      return postings
    })
    assert.equal(
      await db.companyWatch.count({ where: { ownerUserId: { in: owners } } }),
      0,
      "new users have no company watches"
    )
    const [warmRunA, warmRunB] = await Promise.all([
      worker.ensureBoard(board.id),
      worker.ensureBoard(board.id),
    ])
    assert.ok(warmRunA && warmRunB)
    assert.equal(
      warmRunA.id,
      warmRunB.id,
      "concurrent no-watch refreshes converge on one shared warm-board run"
    )
    assert.equal(await worker.ingest(warmRunA.id), "succeeded")
    assert.equal(fetchCount, 1)
    assert.equal(
      await db.jobPosting.count({ where: { boardId: board.id } }),
      7,
      "a warm public board is fetched once without a watcher"
    )

    const [plansA, planB] = await Promise.all([
      Promise.all(Array.from({ length: 5 }, () => worker.plan(owners[0]))),
      worker.plan(owners[1]),
    ])
    assert.equal(
      plansA.reduce((total, plan) => total + plan.queued, 0),
      MAX_AI_PER_USER_DAY,
      "concurrent Find jobs requests enqueue only the private daily AI cap"
    )
    assert.equal(
      plansA.reduce((total, plan) => total + plan.surfaced, 0),
      5,
      "one concurrent scan materializes each deterministic candidate once"
    )
    assert.equal(planB.surfaced, 2)
    assert.equal(planB.queued, 2)
    assert.equal(
      await db.jobMatch.count({
        where: { ownerUserId: owners[0], posting: { boardId: staleBoard.id } },
      }),
      0,
      "postings outside the bounded freshness window do not enter first-use matches"
    )
    assert.equal(
      await db.jobPosting.count({ where: { boardId: board.id } }),
      7,
      "both users share the same seven public postings"
    )
    assert.equal(
      await db.jobMatch.count({
        where: {
          ownerUserId: owners[0],
          posting: { title: { contains: "Software Engineer" } },
        },
      }),
      5
    )
    assert.equal(
      await db.jobMatch.count({
        where: {
          ownerUserId: owners[1],
          posting: { title: { contains: "Data Scientist" } },
        },
      }),
      2
    )
    assert.equal(
      await db.jobMatch.count({
        where: {
          ownerUserId: owners[0],
          posting: { title: { contains: "Data Scientist" } },
        },
      }),
      0,
      "matching stays personalized to each confirmed resume and target"
    )
    assert.equal(
      await db.processingRun.count({
        where: { ownerUserId: owners[0], kind: MATCH_KIND },
      }),
      MAX_AI_PER_USER_DAY
    )

    const uncertainRun = await db.processingRun.findFirstOrThrow({
      where: { ownerUserId: owners[0], kind: MATCH_KIND, status: "pending" },
    })
    let uncertainCalls = 0
    const uncertainWorker = createDiscoveryWorker(db, async () => {
      uncertainCalls++
      throw new Error("connection lost after provider submission")
    })
    assert.equal(await uncertainWorker.processMatch(uncertainRun.id), "failed")
    assert.equal(
      await uncertainWorker.processMatch(uncertainRun.id),
      "not_claimed"
    )
    const uncertainResult = await db.processingRun.findUniqueOrThrow({
      where: { id: uncertainRun.id },
    })
    assert.equal(uncertainResult.errorCode, "provider_outcome_unknown")
    assert.equal(
      uncertainCalls,
      1,
      "an uncertain paid attempt is never retried"
    )

    const discovery = createDiscoveryService(db)
    const authA = { id: owners[0], name: null, email: null } as CurrentAuthUser
    const authB = { id: owners[1], name: null, email: null } as CurrentAuthUser
    const savedPosting = await db.jobPosting.findFirstOrThrow({
      where: { boardId: board.id, externalId: "se-1" },
    })
    const dismissedPosting = await db.jobPosting.findFirstOrThrow({
      where: { boardId: board.id, externalId: "ds-1" },
    })
    await discovery.mutate(authA, {
      action: "state",
      postingId: savedPosting.id,
      state: "saved",
    })
    await discovery.mutate(authB, {
      action: "state",
      postingId: dismissedPosting.id,
      state: "dismissed",
    })
    const targetA = await db.targetPreference.findFirstOrThrow({
      where: { ownerUserId: owners[0] },
    })
    const preferenceResult = await discovery.mutate(authA, {
      action: "preferences",
      expectedRevision: 1,
      targets: [
        {
          targetTitle: targetA.targetTitle,
          location: targetA.location,
          remotePreferred: targetA.remotePreferred,
          minimumCompensationUsd: null,
          keywords: ["TypeScript", "distributed"],
        },
      ],
    })
    assert.ok("funnel" in preferenceResult)
    assert.ok(preferenceResult.funnel)
    assert.equal(preferenceResult.funnel.surfaced, 5)
    assert.equal(
      (await db.userProfile.findUniqueOrThrow({ where: { id: owners[0] } }))
        .preferenceRevision,
      2
    )
    assert.equal(
      await db.targetPreference.count({
        where: { ownerUserId: owners[0], active: true },
      }),
      1
    )
    const saved = await discovery.read(authA, "", "saved")
    const dismissed = await discovery.read(authB, "", "dismissed")
    assert.equal(
      saved.jobs.find((candidate) => candidate.id === savedPosting.id)?.state,
      "saved",
      "saved state survives input-version recomputation without a watch"
    )
    assert.equal(
      dismissed.jobs.find((candidate) => candidate.id === dismissedPosting.id)
        ?.state,
      "dismissed",
      "dismissed state survives recomputation and remains tenant-private"
    )
    assert.equal(
      await db.companyWatch.count({ where: { ownerUserId: { in: owners } } }),
      0,
      "finding and recomputing jobs does not create company watches"
    )

    // The initiating watcher is planned ahead of the bounded fan-out. These
    // ten eligible watchers sort before the caller and would occupy the old
    // LIMIT 10 prefix, even though they have no confirmed resume/preferences.
    await db.userProfile.createMany({
      data: fanoutOwners.map((id) => ({
        id,
        ...trialFields(),
        onboardingCompletedAt: new Date(),
      })),
    })
    await db.companyWatch.createMany({
      data: [...fanoutOwners, owners[0]].map((ownerUserId) => ({
        ownerUserId,
        boardId: board.id,
      })),
    })
    const wakeOnlyJob = job(
      "wake-priority",
      "Senior Software Engineer",
      "Seattle, WA",
      "Build TypeScript services for a growing team."
    )
    postings.push(wakeOnlyJob)
    await db.atsBoard.update({
      where: { id: board.id },
      data: { nextFetchAt: new Date(Date.now() - 1000) },
    })
    const wakeResult = await worker.wake({
      ownerUserId: owners[0],
      boardId: board.id,
    })
    assert.equal(wakeResult.ingested, "succeeded")
    const wakePosting = await db.jobPosting.findFirstOrThrow({
      where: { boardId: board.id, externalId: "wake-priority" },
    })
    assert.ok(
      await db.jobMatch.findFirst({
        where: { ownerUserId: owners[0], jobPostingId: wakePosting.id },
      }),
      "the initiating watcher receives deterministic results despite ten earlier fan-out watchers"
    )
    assert.equal(
      await db.jobMatch.count({
        where: {
          ownerUserId: { in: fanoutOwners },
          jobPostingId: wakePosting.id,
        },
      }),
      0,
      "watcher fan-out does not fabricate matches for users without confirmed inputs"
    )
  } finally {
    await db.companyWatch.deleteMany({
      where: { ownerUserId: { in: [...fanoutOwners, ...owners] } },
    })
    await db.userProfile.deleteMany({ where: { id: { in: fanoutOwners } } })
    await db.aiUsage.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.aiUsageReservation.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.jobMatch.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.userJobState.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.processingRun.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.discoveryAllowance.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.targetPreference.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.resume.updateMany({
      where: { ownerUserId: { in: owners } },
      data: { confirmedVersionId: null, confirmedAt: null },
    })
    await db.resumeVersion.deleteMany({
      where: { ownerUserId: { in: owners } },
    })
    await db.resume.deleteMany({ where: { ownerUserId: { in: owners } } })
    await db.userProfile.deleteMany({ where: { id: { in: owners } } })
    if (boardId) {
      await db.jobPosting.deleteMany({ where: { boardId } })
      await db.atsBoard.delete({ where: { id: boardId } })
    }
    if (staleBoardId) {
      await db.jobPosting.deleteMany({ where: { boardId: staleBoardId } })
      await db.atsBoard.delete({ where: { id: staleBoardId } })
    }
    if (companyId) await db.company.delete({ where: { id: companyId } })
  }
})
