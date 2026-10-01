import assert from "node:assert/strict"
import { isDeepStrictEqual } from "node:util"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import nextEnv from "@next/env"
import {
  AtsProvider,
  ResumeVersionSource,
  ResumeVersionStatus,
} from "../lib/generated/prisma/enums"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import {
  createMatcher,
  type MatchInput,
  type MatchResult,
} from "../lib/ai/matching"
import { MATCH_AI_CONFIG } from "../lib/ai/config"
import { createSessionContext } from "../lib/auth/session-context"
import { createDiscoveryService } from "../lib/domain/discovery/service"
import {
  createDiscoveryWorker,
  INGEST_KIND,
  MATCH_KIND,
} from "../lib/domain/discovery/worker"
import { sanitizedResume } from "../tests/resume-structure-fixtures"

nextEnv.loadEnvConfig(process.cwd())
const env = process.env
assert.equal(
  env.JOBSYNC_DISCOVERY_LIVE_BRANCH,
  "lively-shape-65452824/br-tiny-tree-b44fo1lv",
  "explicit isolated-branch gate required"
)
assert.ok(env.DATABASE_URL, "DATABASE_URL required")
assert.ok(
  new URL(env.DATABASE_URL).hostname.startsWith("ep-green-scene-b45djevq"),
  "proof is restricted to the verified isolated Neon branch"
)
assert.ok(env.OPENROUTER_API_KEY, "actual OpenRouter key required")

const db = createDatabaseClient(env.DATABASE_URL)
const ownerIds = [
  `discovery-proof-engineer-${randomUUID()}`,
  `discovery-proof-designer-${randomUUID()}`,
]
const safeResume = {
  ...sanitizedResume,
  contact: {
    name: "Proof Candidate",
    email: null,
    phone: null,
    location: null,
    links: [],
  },
  summary:
    "Senior software professional with demonstrated product delivery experience.",
  employment: [
    {
      employer: "Example Labs",
      title: "Product Engineer",
      startDate: "January 2022",
      endDate: "March 2025",
      location: null,
      highlights: [
        "Built accessible web applications with React, TypeScript, design systems, and cross-functional product teams.",
      ],
    },
  ],
  education: [],
  credentials: [],
  skills: ["TypeScript", "React", "Product design", "Accessibility", "Figma"],
}
const targets = [
  [
    {
      targetTitle: "Software Engineer",
      location: null,
      remotePreferred: null,
      minimumCompensationUsd: null,
      keywords: ["TypeScript", "React", "product"],
    },
  ],
  [
    {
      targetTitle: "Product Designer",
      location: null,
      remotePreferred: null,
      minimumCompensationUsd: null,
      keywords: ["Figma", "accessibility", "design systems"],
    },
  ],
]
const confirmedResumeForMatching = Object.fromEntries(
  Object.entries(safeResume).filter(([key]) => key !== "contact")
)
const users = await Promise.all(
  ownerIds.map(async (id) => {
    const sessionContext = createSessionContext(
      async () => ({
        data: { user: { id, name: "Discovery Proof", email: null } },
        error: null,
      }),
      () => {
        throw new Error("unexpected_sign_in_redirect")
      }
    )
    const user = await sessionContext.requireCurrentAuthUser()
    assert.equal(user.id, id)
    return user
  })
)
const service = createDiscoveryService(db)
let matcherCalls = 0
const matcherInputs: MatchInput[] = []
const matcherPreflightFailures: {
  code: string
  confirmedResumeMatched: boolean
  descriptionPresent: boolean
  targetCount: number
  resumePayloadCaptured: false
}[] = []
const liveMatcher = createMatcher(env.OPENROUTER_API_KEY)
const matcher = async (
  input: MatchInput,
  receipt?: Parameters<typeof liveMatcher>[1]
): Promise<MatchResult> => {
  const confirmedResumeMatched = isDeepStrictEqual(
    input.resume,
    confirmedResumeForMatching
  )
  const descriptionPresent = input.posting.description.trim().length > 0
  try {
    assert.ok(confirmedResumeMatched, "confirmed_resume_mismatch")
    assert.ok(descriptionPresent, "posting_description_missing")
    assert.ok(input.targets.length > 0, "target_preferences_missing")
  } catch {
    matcherPreflightFailures.push({
      code: !confirmedResumeMatched
        ? "confirmed_resume_mismatch"
        : !descriptionPresent
          ? "posting_description_missing"
          : "target_preferences_missing",
      confirmedResumeMatched,
      descriptionPresent,
      targetCount: input.targets.length,
      resumePayloadCaptured: false,
    })
    throw new Error("matcher_preflight_failed")
  }
  // Count only calls that passed the local data-boundary assertions and are
  // about to enter the actual OpenRouter matcher.
  matcherCalls++
  matcherInputs.push(input)
  return liveMatcher(input, receipt)
}
const worker = createDiscoveryWorker(db, matcher)
const startedAt = Date.now()
const publicBoards = [
  { provider: AtsProvider.greenhouse, slug: "figma", company: "Figma" },
  { provider: AtsProvider.lever, slug: "spotify", company: "Spotify" },
  { provider: AtsProvider.ashby, slug: "linear", company: "Linear" },
] as const
const baselineProfiles = await db.userProfile.findMany({
  select: { id: true, displayName: true, createdAt: true },
  orderBy: { id: "asc" },
})
assert.ok(
  baselineProfiles.length >= 1,
  "preserve every preexisting profile, including any browser-proof user"
)
const boardIds: string[] = []
const evidence: Record<string, unknown> = {
  proof: "shared-discovery-live",
  startedAt: new Date(startedAt).toISOString(),
  providers: {},
  cleanup: "pending",
}

try {
  for (const ownerUserId of ownerIds) {
    await db.userProfile.create({
      data: { id: ownerUserId, onboardingCompletedAt: new Date() },
    })
    const resume = await db.resume.create({
      data: { ownerUserId, title: "Confirmed discovery proof resume" },
    })
    const version = await db.resumeVersion.create({
      data: {
        ownerUserId,
        resumeId: resume.id,
        version: 1,
        source: ResumeVersionSource.manual,
        status: ResumeVersionStatus.ready,
        data: safeResume,
      },
    })
    await db.resume.update({
      where: { id: resume.id },
      data: { confirmedVersionId: version.id, confirmedAt: new Date() },
    })
    // A newer draft contains deliberately irrelevant content and must never reach matching.
    await db.resumeVersion.create({
      data: {
        ownerUserId,
        resumeId: resume.id,
        version: 2,
        source: ResumeVersionSource.manual,
        status: ResumeVersionStatus.draft,
        data: {
          ...safeResume,
          summary: "UNCONFIRMED DRAFT MUST NOT BE SENT TO AI",
          skills: ["Not a confirmed skill"],
        },
      },
    })
    await db.targetPreference.createMany({
      data: targets[ownerIds.indexOf(ownerUserId)]!.map((target) => ({
        ...target,
        ownerUserId,
      })),
    })
  }

  // Spotify is intentionally added as a reusable public board because the upstream directory omits it.
  const spotify = publicBoards[1]
  const spotifyBoard = await db.atsBoard.findUnique({
    where: {
      provider_slug: { provider: spotify.provider, slug: spotify.slug },
    },
  })
  if (!spotifyBoard) {
    const normalized = spotify.company
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
    const stem = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "")
    const digest = createHash("sha256")
      .update(normalized.trim().toLowerCase())
      .digest("hex")
      .slice(0, 10)
    const company = await db.company.upsert({
      where: { slug: `${stem}-${digest}` },
      create: { name: spotify.company, slug: `${stem}-${digest}` },
      update: {},
    })
    await db.atsBoard.create({
      data: {
        companyId: company.id,
        provider: spotify.provider,
        slug: spotify.slug,
        region: "global",
      },
    })
  }
  for (const item of publicBoards) {
    const board = await db.atsBoard.findUniqueOrThrow({
      where: { provider_slug: { provider: item.provider, slug: item.slug } },
      include: { company: true },
    })
    assert.equal(board.company.name, item.company)
    boardIds.push(board.id)
    await db.atsBoard.update({
      where: { id: board.id },
      data: { enabled: true, nextFetchAt: new Date(0) },
    })
  }
  for (const user of users)
    for (const boardId of boardIds)
      await service.mutate(user, { action: "watch", boardId, watching: true })

  const beforePostings = await db.jobPosting.count({
    where: { boardId: { in: boardIds } },
  })
  const beforeFetchCounts = await db.atsBoard.findMany({
    where: { id: { in: boardIds } },
    select: { id: true, fetchCount: true },
  })
  const ensureBatches = await Promise.all(
    boardIds.map((boardId) =>
      Promise.all(Array.from({ length: 20 }, () => worker.ensureBoard(boardId)))
    )
  )
  assert.ok(
    ensureBatches.every((batch) => batch.every(Boolean)),
    "watched boards should schedule shared ingestion"
  )
  assert.ok(
    ensureBatches.every(
      (batch) => new Set(batch.map((run) => run!.id)).size === 1
    ),
    "concurrent schedulers must converge on one durable run per board"
  )
  const runs = ensureBatches.map((batch) => batch[0]!)
  const ingestionResults = []
  const ingestionTimings = []
  for (const run of runs) {
    const ingestStartedAt = Date.now()
    ingestionResults.push(await worker.ingest(run.id))
    ingestionTimings.push({
      runId: run.id,
      latencyMs: Date.now() - ingestStartedAt,
    })
  }
  assert.ok(
    ingestionResults.every((result) => result === "succeeded"),
    `all three providers must ingest: ${ingestionResults.join(",")}`
  )
  const afterBoards = await db.atsBoard.findMany({
    where: { id: { in: boardIds } },
    select: { id: true, fetchCount: true },
  })
  const boardPostingCounts = await db.jobPosting.groupBy({
    by: ["boardId"],
    where: { boardId: { in: boardIds }, open: true },
    _count: { _all: true },
  })
  const postingsAfterIngestion = await db.jobPosting.count({
    where: { boardId: { in: boardIds } },
  })
  assert.ok(
    boardPostingCounts.length === 3 &&
      boardPostingCounts.every((row) => row._count._all > 0),
    "each actual public board should yield open shared postings"
  )
  assert.deepEqual(
    afterBoards.map(
      (b) =>
        b.fetchCount - beforeFetchCounts.find((x) => x.id === b.id)!.fetchCount
    ),
    [1, 1, 1],
    "each shared board fetched exactly once"
  )
  assert.ok(
    (
      await Promise.all(boardIds.map((boardId) => worker.ensureBoard(boardId)))
    ).every((run) => run === null),
    "fresh shared boards must not enqueue duplicate ingestion"
  )
  assert.equal(
    await db.jobPosting.count({ where: { boardId: { in: boardIds } } }),
    postingsAfterIngestion
  )

  const funnels = await Promise.all(users.map((user) => worker.plan(user.id)))
  assert.ok(
    funnels.every((funnel) => funnel.eligible > 0),
    `both profiles must produce eligible jobs: ${JSON.stringify(funnels)}`
  )
  const duplicatePlans = await Promise.all(
    users.map((user) => worker.plan(user.id))
  )
  assert.ok(
    duplicatePlans.every((funnel) => funnel.queued === 0),
    "replayed plans must not enqueue duplicate matches"
  )
  const matchRuns = await db.processingRun.findMany({
    where: {
      ownerUserId: { in: ownerIds },
      kind: MATCH_KIND,
      status: "pending",
    },
    orderBy: { createdAt: "asc" },
  })
  assert.equal(
    matchRuns.length,
    6,
    "planner should respect the three-candidate per-user daily cap"
  )
  const selectedMatchRuns = ownerIds.map((ownerUserId) =>
    matchRuns.find((run) => run.ownerUserId === ownerUserId)!
  )
  const retainedRunIds = new Set(selectedMatchRuns.map((run) => run.id))
  await db.processingRun.updateMany({
    where: {
      id: {
        in: matchRuns
          .filter((run) => !retainedRunIds.has(run.id))
          .map((run) => run.id),
      },
    },
    data: { status: "canceled", errorCode: "live_proof_ai_budget" },
  })
  const [result1, result2] = await Promise.all(
    selectedMatchRuns.map((run) => worker.processMatch(run.id))
  )
  const selectedRunDiagnostics = await db.processingRun.findMany({
    where: { id: { in: selectedMatchRuns.map((run) => run.id) } },
    select: {
      id: true,
      status: true,
      errorCode: true,
      startedAt: true,
      completedAt: true,
    },
  })
  evidence.aiAttemptDiagnostics = selectedRunDiagnostics.map((run) => ({
    ...run,
    latencyMs:
      run.startedAt && run.completedAt
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null,
  }))
  assert.ok(
    [result1, result2].every((result) => result === "succeeded"),
    `bounded live AI attempts failed: ${JSON.stringify(selectedRunDiagnostics.map(({ id, status, errorCode }) => ({ id, status, errorCode })))}`
  )
  assert.equal(matcherCalls, 2)
  assert.ok(
    matcherInputs.every(
      (input) =>
        !JSON.stringify(input).includes(
          "UNCONFIRMED DRAFT MUST NOT BE SENT TO AI"
        )
    )
  )
  assert.deepEqual(
    matcherInputs.map((input) => input.targets[0]?.targetTitle).sort(),
    ["Product Designer", "Software Engineer"]
  )
  const aiRows = await db.aiUsage.findMany({
    where: { ownerUserId: { in: ownerIds } },
    orderBy: { createdAt: "asc" },
  })
  assert.equal(aiRows.length, 2)
  assert.ok(
    aiRows.every(
      (row) =>
        row.provider === "openrouter" &&
        row.model === MATCH_AI_CONFIG.model &&
        row.costMicroUsd !== null
    )
  )
  const duplicateProcess = await Promise.all(
    selectedMatchRuns.map((run) => worker.processMatch(run.id))
  )
  assert.ok(duplicateProcess.every((result) => result === "not_claimed"))
  assert.equal(
    await db.aiUsage.count({ where: { ownerUserId: { in: ownerIds } } }),
    2,
    "duplicate dispatch cannot double charge"
  )

  const postingIds = await Promise.all(
    ownerIds.map(
      async (ownerUserId) =>
        (
          await db.jobMatch.findFirstOrThrow({
            where: { ownerUserId, aiAnalyzedAt: { not: null } },
            orderBy: { createdAt: "desc" },
          })
        ).jobPostingId
    )
  )
  const initialRead = await Promise.all(
    users.map((user) => service.read(user, "", "new"))
  )
  assert.ok(
    initialRead.every((data) => data.jobs.some((job) => job.aiScore !== null))
  )
  await service.mutate(users[0]!, {
    action: "state",
    postingId: postingIds[0],
    state: "saved",
  })
  await service.mutate(users[1]!, {
    action: "state",
    postingId: postingIds[1],
    state: "dismissed",
  })
  const saved = await service.read(users[0]!, "", "saved")
  const dismissed = await service.read(users[1]!, "", "dismissed")
  assert.ok(saved.jobs.some((job) => job.id === postingIds[0]))
  assert.ok(dismissed.jobs.some((job) => job.id === postingIds[1]))
  assert.ok(
    !(await service.read(users[1]!, "", "saved")).jobs.some(
      (job) => job.id === postingIds[0]
    ),
    "saved state must be tenant private"
  )
  assert.ok(
    !(await service.read(users[0]!, "", "dismissed")).jobs.some(
      (job) => job.id === postingIds[1]
    ),
    "dismissed state must be tenant private"
  )

  // Preference revision change makes the old immutable match non-current; next plan is recomputable.
  const profile = await db.userProfile.findUniqueOrThrow({
    where: { id: ownerIds[0]! },
  })
  const nextTargets = [
    { ...targets[0]![0]!, keywords: ["TypeScript", "React", "accessibility"] },
  ]
  await service.mutate(users[0]!, {
    action: "preferences",
    expectedRevision: profile.preferenceRevision,
    targets: nextTargets,
  })
  const staleCount = await db.jobMatch.count({
    where: {
      ownerUserId: ownerIds[0],
      preferenceRevision: profile.preferenceRevision,
    },
  })
  assert.ok(staleCount > 0)
  const nextPlan = await worker.plan(ownerIds[0]!)
  assert.ok(nextPlan.eligible > 0)

  const afterPostings = postingsAfterIngestion
  const byOwner = await Promise.all(
    ownerIds.map(async (ownerUserId) => ({
      ownerUserId,
      matches: await db.jobMatch.count({ where: { ownerUserId } }),
      eligible: funnels[ownerIds.indexOf(ownerUserId)]!.eligible,
    }))
  )
  evidence.providers = publicBoards.map((board, index) => ({
    ...board,
    fetchCountDelta:
      afterBoards.find((b) => b.id === boardIds[index])!.fetchCount -
      beforeFetchCounts.find((b) => b.id === boardIds[index])!.fetchCount,
    openPostings:
      boardPostingCounts.find((x) => x.boardId === boardIds[index])?._count
        ._all ?? 0,
  }))
  evidence.ingestionAttempts = ingestionTimings
  evidence.shared = {
    postingsBefore: beforePostings,
    postingsAfter: afterPostings,
    newOrUpdatedSharedRows: afterPostings - beforePostings,
    twoWatchersPerBoard: true,
    sharedFetchPerBoard: 1,
  }
  evidence.funnel = funnels.map((f, i) => ({
    owner: i === 0 ? "engineer" : "designer",
    considered: f.considered,
    eligible: f.eligible,
    surfaced: f.surfaced,
    queuedForAi: f.queued,
  }))
  evidence.matches = byOwner
  evidence.ai = {
    calls: matcherCalls,
    model: aiRows[0]?.model,
    provider: aiRows[0]?.provider,
    totalInputTokens: aiRows.reduce(
      (sum, row) => sum + (row.inputTokens ?? 0),
      0
    ),
    totalOutputTokens: aiRows.reduce(
      (sum, row) => sum + (row.outputTokens ?? 0),
      0
    ),
    totalCostMicroUsd: aiRows
      .reduce((sum, row) => sum + (row.costMicroUsd ?? BigInt(0)), BigInt(0))
      .toString(),
    requestIds: aiRows.map((row) => row.providerRequestId),
    latencyMs: Date.now() - startedAt,
  }
  evidence.idempotency = {
    repeatPlanQueued: duplicatePlans.map((f) => f.queued),
    repeatedWorkerNoop: duplicateProcess,
    aiRowsAfterReplay: 2,
  }
  evidence.privateState = {
    engineerSavedOwnJob: true,
    designerDismissedOwnJob: true,
    crossTenantIsolation: true,
  }
  evidence.staleness = {
    changedPreferenceRevision: true,
    oldMatchRevision: profile.preferenceRevision,
    currentRevision: profile.preferenceRevision + 1,
    recomputableEligible: nextPlan.eligible,
  }
  evidence.scheduled = {
    durableProcessingRuns: await db.processingRun.count({
      where: {
        kind: INGEST_KIND,
        resourceId: { in: boardIds },
        status: "succeeded",
      },
    }),
    scheduleInvocation:
      "verified separately through deployed Neon Function cron",
  }
  evidence.elapsedMs = Date.now() - startedAt
} catch (error) {
  const message = error instanceof Error ? error.message : "proof_step_failed"
  evidence.failure = {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null,
    message: message.startsWith("bounded live AI attempts failed:")
      ? message
      : "proof_step_failed",
  }
  throw error
} finally {
  // Capture failure diagnostics and settled receipts before deleting fixture ledgers.
  const [proofUsage, proofRuns, boardRuns] = await Promise.all([
    db.aiUsage.findMany({
      where: { ownerUserId: { in: ownerIds } },
      orderBy: { createdAt: "asc" },
    }),
    db.processingRun.findMany({
      where: { ownerUserId: { in: ownerIds }, kind: MATCH_KIND },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        errorCode: true,
        attempt: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    boardIds.length
      ? db.processingRun.findMany({
          where: {
            ownerUserId: null,
            kind: INGEST_KIND,
            resourceId: { in: boardIds },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            resourceId: true,
            status: true,
            errorCode: true,
            checkpoint: true,
            startedAt: true,
            completedAt: true,
          },
        })
      : Promise.resolve([]),
  ])
  evidence.aiReceipts = proofUsage.map((row) => {
    const metadata =
      row.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    const micro = row.costMicroUsd
    return {
      owner: row.ownerUserId === ownerIds[0] ? "engineer" : "designer",
      status: row.status,
      errorCode: row.errorCode,
      provider: row.provider,
      model: row.model,
      providerRequestId: row.providerRequestId,
      generationId: row.providerRequestId,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      actualCostUsd:
        typeof metadata.actualCostUsd === "number"
          ? metadata.actualCostUsd
          : micro === null
            ? null
            : Number(micro) / 1_000_000,
      costMicroUsd: micro?.toString() ?? null,
      latencyMs:
        typeof metadata.latencyMs === "number" ? metadata.latencyMs : null,
      finishReason:
        typeof metadata.finishReason === "string"
          ? metadata.finishReason
          : null,
    }
  })
  evidence.matcherPreflightFailures = matcherPreflightFailures
  evidence.actualMatcherDispatches = matcherCalls
  evidence.matchRuns = proofRuns.map((run) => ({
    id: run.id,
    owner: run.ownerUserId === ownerIds[0] ? "engineer" : "designer",
    status: run.status,
    errorCode: run.errorCode,
    attempt: run.attempt,
    latencyMs:
      run.startedAt && run.completedAt
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null,
  }))
  evidence.boardRuns = boardRuns.map((run) => ({
    id: run.id,
    boardId: run.resourceId,
    status: run.status,
    errorCode: run.errorCode,
    checkpoint: run.checkpoint,
    latencyMs:
      run.startedAt && run.completedAt
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null,
  }))
  evidence.failure ??= null
  // Clean only proof-owned private rows. Public companies, boards, postings and their shared ingestion history remain reusable.
  await db.userJobState.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
  await db.jobMatch.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
  await db.companyWatch.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
  await db.targetPreference.deleteMany({
    where: { ownerUserId: { in: ownerIds } },
  })
  await db.resume.updateMany({
    where: { ownerUserId: { in: ownerIds } },
    data: { confirmedVersionId: null, confirmedAt: null },
  })
  await db.resumeVersion.deleteMany({
    where: { ownerUserId: { in: ownerIds } },
  })
  await db.aiUsage.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
  await db.aiUsageReservation.deleteMany({
    where: { ownerUserId: { in: ownerIds } },
  })
  await db.processingRun.deleteMany({
    where: { ownerUserId: { in: ownerIds } },
  })
  await db.resume.deleteMany({ where: { ownerUserId: { in: ownerIds } } })
  await db.userProfile.deleteMany({ where: { id: { in: ownerIds } } })
  assert.deepEqual(
    await db.userProfile.findMany({
      select: { id: true, displayName: true, createdAt: true },
      orderBy: { id: "asc" },
    }),
    baselineProfiles,
    "founder and preexisting profile rows must be preserved"
  )
  evidence.cleanup = "complete"
  await mkdir(join(process.cwd(), "output"), { recursive: true })
  await writeFile(
    join(process.cwd(), "output/discovery-live-proof.json"),
    JSON.stringify(
      evidence,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    ) + "\n",
    { mode: 0o600 }
  )
  console.info(
    JSON.stringify(evidence, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  )
  await db.$disconnect()
}
