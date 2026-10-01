import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import nextEnv from "@next/env"
import {
  ResumeVersionSource,
  ResumeVersionStatus,
} from "../lib/generated/prisma/enums"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { sanitizedResume } from "../tests/resume-structure-fixtures"

nextEnv.loadEnvConfig(process.cwd())

const EXPECTED_PROJECT_ID = "lively-shape-65452824"
const EXPECTED_BRANCH_ID = "br-tiny-tree-b44fo1lv"
const EXPECTED_BRANCH = `${EXPECTED_PROJECT_ID}/${EXPECTED_BRANCH_ID}`
const EXPECTED_DB_HOST_PREFIX = "ep-green-scene-b45djevq"
const EXPECTED_APP_ORIGIN = "https://jobsync-cloud.vercel.app"
const WATCH_POLL_DEADLINE_MS = 330_000
const OUTPUT_PATH = join("output", "discovery-baseline-proof.json")

function cookieHeader(setCookies: string[]) {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ")
}

function safeCount(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null
  const result = (value as Record<string, unknown>)[key]
  return Array.isArray(result) ? result.length : null
}

const env = process.env
assert.equal(
  env.JOBSYNC_DISCOVERY_LIVE_BRANCH,
  EXPECTED_BRANCH,
  "explicit isolated production branch gate required"
)
assert.ok(env.DATABASE_URL, "DATABASE_URL is required")
assert.equal(
  new URL(env.DATABASE_URL).hostname.split(".")[0]?.split("-")[0],
  EXPECTED_DB_HOST_PREFIX.split("-")[0],
  "database host must be the isolated proof endpoint"
)
assert.ok(
  new URL(env.DATABASE_URL).hostname.startsWith(EXPECTED_DB_HOST_PREFIX),
  "database host must match the isolated proof endpoint"
)
const applicationOrigin = new URL(
  env.JOBSYNC_BROWSER_ORIGIN ?? EXPECTED_APP_ORIGIN
).origin
assert.equal(
  applicationOrigin,
  EXPECTED_APP_ORIGIN,
  "proof is restricted to the approved production application"
)
assert.ok(env.NEON_ACCOUNT_CLEANUP_API_KEY, "auth cleanup API key is required")
assert.equal(env.NEON_ACCOUNT_CLEANUP_PROJECT_ID, EXPECTED_PROJECT_ID)
assert.equal(env.NEON_ACCOUNT_CLEANUP_BRANCH_ID, EXPECTED_BRANCH_ID)

const db = createDatabaseClient(env.DATABASE_URL)
const startedAt = Date.now()
const email = `discovery-baseline-${randomUUID()}@example.com`
const password = `DiscoveryBaseline-${randomUUID()}!Aa9`
const evidence: Record<string, unknown> = {
  proof: "old-production-discovery-watch-baseline",
  startedAt: new Date(startedAt).toISOString(),
  applicationOrigin,
  isolation: {
    projectId: EXPECTED_PROJECT_ID,
    branchId: EXPECTED_BRANCH_ID,
    databaseHost: new URL(env.DATABASE_URL).hostname,
  },
  fixture:
    "synthetic confirmed resume seeded directly; no upload was performed",
  cleanup: "pending",
}
let ownerUserId: string | undefined
let resumeId: string | undefined
let boardId: string | undefined
let sessionCookie = ""
let successful = false
let baselineProfiles: { id: string; createdAt: Date }[] = []
let baselinePostingCount = 0

async function api(
  path: string,
  method: string,
  body?: unknown,
  cookie = sessionCookie
) {
  const headers = new Headers({ Origin: applicationOrigin })
  if (body !== undefined) headers.set("Content-Type", "application/json")
  if (cookie) headers.set("Cookie", cookie)
  const response = await fetch(new URL(path, applicationOrigin), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length) sessionCookie = cookieHeader(setCookies)
  return response
}

async function authenticateFixture() {
  const signup = await api(
    "/api/auth/sign-up/email",
    "POST",
    { name: "JobSync discovery baseline", email, password },
    ""
  )
  const signupBody = (await signup.json().catch(() => null)) as {
    user?: { id?: unknown }
  } | null
  assert.ok(signup.ok, `managed-auth signup failed with ${signup.status}`)
  assert.equal(typeof signupBody?.user?.id, "string")
  ownerUserId = signupBody!.user!.id as string
  assert.ok(
    sessionCookie,
    "signup did not return an authenticated session cookie"
  )

  const verified = await db.$queryRaw<{ id: string; email: string }[]>`
    UPDATE neon_auth."user" SET "emailVerified"=true
    WHERE id=${ownerUserId} AND email=${email}
    RETURNING id,email
  `
  assert.equal(
    verified.length,
    1,
    "admin verification must match exact fixture ID and email"
  )
  assert.equal(verified[0]?.id, ownerUserId)
  assert.equal(verified[0]?.email, email)

  const signin = await api(
    "/api/auth/sign-in/email",
    "POST",
    { email, password },
    ""
  )
  assert.ok(signin.ok, `managed-auth sign-in failed with ${signin.status}`)
  const signinBody = (await signin.json().catch(() => null)) as {
    user?: { id?: unknown; emailVerified?: unknown }
  } | null
  assert.equal(signinBody?.user?.id, ownerUserId)
  assert.equal(signinBody?.user?.emailVerified, true)
  assert.ok(
    sessionCookie,
    "sign-in did not return an authenticated session cookie"
  )

  const onboarding = await api("/api/onboarding", "GET")
  assert.equal(
    onboarding.status,
    200,
    "onboarding API must provision the app profile"
  )
  return ownerUserId
}

async function seedSyntheticProfile(owner: string) {
  const now = new Date()
  const profile = await db.userProfile.update({
    where: { id: owner },
    data: {
      emailVerifiedAt: now,
      trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
      onboardingCompletedAt: now,
    },
  })
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: "Synthetic discovery baseline resume" },
  })
  resumeId = resume.id
  const version = await db.resumeVersion.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      version: 1,
      source: ResumeVersionSource.manual,
      status: ResumeVersionStatus.ready,
      data: {
        ...sanitizedResume,
        contact: {
          name: "Baseline Candidate",
          email: null,
          phone: null,
          location: null,
          links: [],
        },
        summary:
          "Software engineer building reliable products with TypeScript and React.",
        skills: ["TypeScript", "React", "PostgreSQL", "APIs", "Accessibility"],
      },
    },
  })
  await db.resume.update({
    where: { id: resume.id },
    data: { confirmedVersionId: version.id, confirmedAt: now },
  })
  await db.targetPreference.create({
    data: {
      ownerUserId: owner,
      targetTitle: "Software Engineer",
      location: null,
      remotePreferred: null,
      minimumCompensationUsd: null,
      keywords: ["TypeScript", "React", "product"],
    },
  })
  assert.equal(profile.id, owner)
  return { resume, version }
}

try {
  baselineProfiles = await db.userProfile.findMany({
    select: { id: true, createdAt: true },
    orderBy: { id: "asc" },
  })
  assert.ok(
    baselineProfiles.length >= 1,
    "expected the established founder profile"
  )
  baselinePostingCount = await db.jobPosting.count()
  const owner = await authenticateFixture()
  const { resume, version } = await seedSyntheticProfile(owner)
  const board = await db.atsBoard.findFirst({
    where: {
      enabled: true,
      provider: "greenhouse",
      slug: "figma",
      lastSuccessAt: { gte: new Date(Date.now() - 6 * 60 * 60_000) },
    },
    include: { company: true },
  })
  assert.ok(board, "a fresh shared Figma board is required for this baseline")
  assert.equal(board.company.name, "Figma")
  boardId = board.id
  assert.ok(
    (await db.jobPosting.count({ where: { boardId: board.id, open: true } })) >
      0,
    "fresh Figma board must already have open shared postings"
  )

  const initialFeed = await api("/api/discovery", "GET")
  assert.equal(initialFeed.status, 200)
  const initialFeedData = (await initialFeed.json()) as Record<string, unknown>
  const initialMatchCount = safeCount(initialFeedData, "jobs")
  assert.equal(
    initialMatchCount,
    0,
    "new account must start with no private matches"
  )
  evidence.initialFeed = {
    status: initialFeed.status,
    deterministicMatches: safeCount(initialFeedData, "jobs"),
    followedCompanies: safeCount(initialFeedData, "watches"),
  }
  assert.equal(safeCount(initialFeedData, "jobs"), 0)
  assert.equal(safeCount(initialFeedData, "watches"), 0)

  const discoverPage = await api("/dashboard/discover", "GET")
  const discoverHtml = await discoverPage.text()
  evidence.oldDiscoverUi = {
    status: discoverPage.status,
    findJobsLabelPresent: /Find jobs/i.test(discoverHtml),
    companySetupCopyPresent:
      /choose companies|select companies|follow companies/i.test(discoverHtml),
  }

  const unsupportedFindStartedAt = Date.now()
  const findResponse = await api("/api/discovery", "POST", { action: "find" })
  evidence.oldFindAction = {
    status: findResponse.status,
    latencyMs: Date.now() - unsupportedFindStartedAt,
  }
  assert.equal(
    findResponse.status,
    400,
    "baseline must stop if the new Find jobs action is already deployed"
  )
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const afterFindFeed = await api("/api/discovery", "GET")
  const afterFindData = (await afterFindFeed.json()) as Record<string, unknown>
  evidence.afterFindOneSecond = {
    status: afterFindFeed.status,
    deterministicMatches: safeCount(afterFindData, "jobs"),
  }
  assert.equal(safeCount(afterFindData, "jobs"), 0)

  const watchStartedAt = Date.now()
  evidence.watchStartedAt = new Date(watchStartedAt).toISOString()
  console.info(
    JSON.stringify({
      event: "discovery_baseline_watch_started",
      startedAt: evidence.watchStartedAt,
      board: "Figma",
    })
  )
  const watchResponse = await api("/api/discovery", "POST", {
    action: "watch",
    boardId: board.id,
    watching: true,
  })
  assert.equal(watchResponse.status, 200, "authenticated watch must succeed")
  evidence.watchResponseMs = Date.now() - watchStartedAt

  const firstDeterministicDeadline = watchStartedAt + WATCH_POLL_DEADLINE_MS
  let firstResultsAt: number | null = null
  let firstMatchIds: string[] = []
  let firstVisibleCount = 0
  while (Date.now() < firstDeterministicDeadline) {
    const matches = await db.jobMatch.findMany({
      where: {
        ownerUserId: owner,
        resumeId: resume.id,
        resumeVersionId: version.id,
      },
      orderBy: [{ relevance: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        jobPostingId: true,
        createdAt: true,
        aiAnalyzedAt: true,
      },
      take: 50,
    })
    if (matches.length) {
      const feedResponse = await api("/api/discovery", "GET")
      const feed = (await feedResponse.json()) as Record<string, unknown>
      const visibleCount = safeCount(feed, "jobs") ?? 0
      if (visibleCount > 0) {
        firstResultsAt = Date.now()
        firstMatchIds = matches.map((match) => match.id)
        firstVisibleCount = visibleCount
        break
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  evidence.firstDeterministicResults = {
    latencyMs: firstResultsAt === null ? null : firstResultsAt - watchStartedAt,
    visibleCount: firstVisibleCount,
    privateMatchCount: firstMatchIds.length,
    deadlineMs: WATCH_POLL_DEADLINE_MS,
    firstMatchIds,
  }

  const aiObservationDeadline = Date.now() + 60_000
  let aiUsage: Awaited<ReturnType<typeof db.aiUsage.findMany>> = []
  let enhancedMatches: { aiAnalyzedAt: Date | null }[] = []
  while (Date.now() < aiObservationDeadline) {
    ;[aiUsage, enhancedMatches] = await Promise.all([
      db.aiUsage.findMany({
        where: { ownerUserId: owner, feature: "job_match_v1" },
        orderBy: { createdAt: "asc" },
      }),
      db.jobMatch.findMany({
        where: {
          ownerUserId: owner,
          resumeId: resume.id,
          resumeVersionId: version.id,
          aiAnalyzedAt: { not: null },
        },
        orderBy: { aiAnalyzedAt: "asc" },
        select: { aiAnalyzedAt: true },
        take: 1,
      }),
    ])
    const settledUsage = aiUsage.some((usage) =>
      ["succeeded", "failed", "unknown"].includes(usage.status)
    )
    if (enhancedMatches.length || settledUsage) break
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  const firstAi = enhancedMatches[0]?.aiAnalyzedAt ?? null
  evidence.aiBaseline = {
    firstEnhancedMatchAt: firstAi?.toISOString() ?? null,
    elapsedFromWatchMs: firstAi ? firstAi.getTime() - watchStartedAt : null,
    usageCount: aiUsage.length,
    calls: aiUsage.map((usage) => ({
      at: usage.createdAt.toISOString(),
      feature: usage.feature,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicroUsd: usage.costMicroUsd?.toString() ?? null,
      status: usage.status,
      errorCode: usage.errorCode,
      providerRequestId: usage.providerRequestId,
    })),
  }
  evidence.baselineSharedPostingCount = baselinePostingCount
  evidence.resumeId = resumeId
  evidence.watchedBoardId = boardId
  evidence.deterministicFirstResult = firstResultsAt !== null
  evidence.fixture =
    "synthetic confirmed resume and Software Engineer target were seeded directly; no upload was performed"
  successful = firstResultsAt !== null
} catch {
  evidence.failure = "baseline_proof_failed"
  throw new Error(
    "Discovery production baseline proof failed; see sanitized evidence file"
  )
} finally {
  if (ownerUserId) {
    try {
      // Capture fixture-owned run outcomes before cleanup, while preserving shared public board/postings.
      const [runs, ledgerBeforeCleanup] = await Promise.all([
        db.processingRun.findMany({
          where: { ownerUserId },
          orderBy: { createdAt: "asc" },
          select: {
            kind: true,
            status: true,
            attempt: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            errorCode: true,
          },
        }),
        db.aiUsage.count({ where: { ownerUserId } }),
      ])
      evidence.runs = runs.map((run) => ({
        kind: run.kind,
        status: run.status,
        attempt: run.attempt,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        errorCode: run.errorCode,
      }))
      evidence.privateUsageRowsBeforeCleanup = ledgerBeforeCleanup
      await db.$transaction(async (tx) => {
        await tx.applicationEvent.deleteMany({
          where: { application: { ownerUserId } },
        })
        await tx.application.deleteMany({ where: { ownerUserId } })
        await tx.userJobState.deleteMany({ where: { ownerUserId } })
        await tx.jobMatch.deleteMany({ where: { ownerUserId } })
        await tx.companyWatch.deleteMany({ where: { ownerUserId } })
        await tx.targetPreference.deleteMany({ where: { ownerUserId } })
        await tx.resume.updateMany({
          where: { ownerUserId },
          data: { confirmedVersionId: null, confirmedAt: null },
        })
        await tx.resumeVersion.deleteMany({ where: { ownerUserId } })
        await tx.aiUsage.deleteMany({ where: { ownerUserId } })
        await tx.aiUsageReservation.deleteMany({ where: { ownerUserId } })
        await tx.processingRun.deleteMany({ where: { ownerUserId } })
        await tx.discoveryAllowance.deleteMany({ where: { ownerUserId } })
        await tx.accountDeletionRequest.deleteMany({ where: { ownerUserId } })
        await tx.resume.deleteMany({ where: { ownerUserId } })
        await tx.userProfile.deleteMany({ where: { id: ownerUserId } })
      })
      execFileSync(
        "neon",
        [
          "neon-auth",
          "user",
          "delete",
          ownerUserId,
          "--project-id",
          EXPECTED_PROJECT_ID,
          "--branch",
          EXPECTED_BRANCH_ID,
        ],
        { stdio: "ignore" }
      )
      const [remainingProfile, remainingPrivateMatches, finalPostings] =
        await Promise.all([
          db.userProfile.count({ where: { id: ownerUserId } }),
          db.jobMatch.count({ where: { ownerUserId } }),
          db.jobPosting.count(),
        ])
      assert.equal(remainingProfile, 0)
      assert.equal(remainingPrivateMatches, 0)
      assert.ok(finalPostings >= 0)
      const finalProfiles = await db.userProfile.findMany({
        select: { id: true, createdAt: true },
        orderBy: { id: "asc" },
      })
      assert.deepEqual(finalProfiles, baselineProfiles)
      evidence.cleanup = "complete"
      evidence.fixtureAuthUserRemoved = true
      evidence.fixturePrivateRowsRemoved = true
      evidence.sharedPublicPostingCountAfterCleanup = finalPostings
      evidence.sharedPostingCountUnchanged =
        finalPostings === baselinePostingCount
      evidence.preexistingProfilesPreserved = true
      evidence.ownerUserId = ownerUserId
      successful ||= false
    } catch {
      evidence.cleanup = "failed"
      evidence.cleanupError = "fixture_cleanup_failed"
      process.exitCode = 1
    }
  } else {
    evidence.cleanup = "no_fixture_identity_created"
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.baselineComplete = successful
  await mkdir("output", { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`)
  await db.$disconnect()
  console.info(
    JSON.stringify({
      event: "discovery_baseline_complete",
      output: OUTPUT_PATH,
      cleanup: evidence.cleanup,
      firstResultLatencyMs: (
        evidence.firstDeterministicResults as
          { latencyMs?: number | null } | undefined
      )?.latencyMs,
    })
  )
}
