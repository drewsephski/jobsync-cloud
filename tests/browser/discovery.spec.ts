import { test, expect, type Page } from "@playwright/test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { createDatabaseClient } from "../../lib/backend/create-db-client"
import { createStorageClient } from "../../lib/backend/create-storage-client"
import { freshBoardFilter } from "../../lib/domain/discovery/catalog"
import { MATCH_AI_CONFIG } from "../../lib/ai/config"
import { resumeDocx } from "../resume-structure-fixtures"

const project = "lively-shape-65452824"
const branch = "br-tiny-tree-b44fo1lv"
const db = createDatabaseClient(process.env.DATABASE_URL!)
const owners: string[] = []
const password = `Discovery-proof-${randomUUID()}!`
const baselineProfiles: { id: string; createdAt: Date }[] = []
const baselinePostingCount = { value: 0 }
const evidence: Record<string, unknown> = {
  proof: "discovery-first-use-live",
  startedAt: new Date().toISOString(),
  cleanup: "pending",
}

async function persistEvidence() {
  await mkdir("output", { recursive: true })
  await writeFile(
    join("output", "discovery-first-use-proof.json"),
    `${JSON.stringify(evidence, null, 2)}\n`
  )
}

test.beforeAll(async () => {
  assert.equal(
    process.env.JOBSYNC_DISCOVERY_FIRST_USE_PROOF,
    "https://jobsync-cloud.vercel.app",
    "explicit isolated production proof opt-in required"
  )
  assert.equal(
    new URL(process.env.JOBSYNC_BROWSER_ORIGIN!).origin,
    process.env.JOBSYNC_DISCOVERY_FIRST_USE_PROOF,
    "browser origin must match the explicitly approved production app"
  )
  assert.ok(
    new URL(process.env.DATABASE_URL!).hostname.startsWith(
      "ep-green-scene-b45djevq"
    ),
    "browser tests require the isolated production branch"
  )
  baselineProfiles.push(
    ...(await db.userProfile.findMany({
      select: { id: true, createdAt: true },
      orderBy: { id: "asc" },
    }))
  )
  baselinePostingCount.value = await db.jobPosting.count()
})

test.afterAll(async () => {
  const s3 = createStorageClient({
    endpoint: process.env.AWS_ENDPOINT_URL_S3!,
    region: process.env.AWS_REGION!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  })
  try {
    if (owners.length) {
      try {
        evidence.ai = await recordAiEvidence(owners)
      } catch (error) {
        evidence.aiEvidenceError =
          error instanceof Error ? error.message : "unknown"
      }
      await persistEvidence()
      const now = new Date()
      await db.userProfile.updateMany({
        where: { id: { in: owners } },
        data: { deletionRequestedAt: now },
      })
      await db.processingRun.updateMany({
        where: {
          ownerUserId: { in: owners },
          status: { in: ["pending", "retry_wait"] },
        },
        data: { status: "canceled", cancellationRequestedAt: now },
      })
      await db.processingRun.updateMany({
        where: { ownerUserId: { in: owners }, status: "running" },
        data: { cancellationRequestedAt: now },
      })
      await waitFor(
        async () =>
          (await db.processingRun.count({
            where: { ownerUserId: { in: owners }, status: "running" },
          })) === 0
            ? true
            : null,
        45_000,
        "private discovery workers did not quiesce for fixture cleanup"
      )
      try {
        evidence.ai = await recordAiEvidence(owners)
      } catch (error) {
        evidence.aiEvidenceAfterQuiesceError =
          error instanceof Error ? error.message : "unknown"
      }
      await persistEvidence()
    }
    assert.ok(owners.every((id) => !baselineProfiles.some((p) => p.id === id)))
    if (owners.length) {
      const uploads = await db.resumeUpload.findMany({
        where: { ownerUserId: { in: owners } },
        select: { objectKey: true },
      })
      for (const upload of uploads)
        await s3.send(
          new DeleteObjectCommand({
            Bucket: "jobsync-files",
            Key: upload.objectKey,
          })
        )
      await db.application.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.userJobState.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.jobMatch.deleteMany({ where: { ownerUserId: { in: owners } } })
      await db.companyWatch.deleteMany({
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
        where: { ownerUserId: { in: owners }, originDraftId: { not: null } },
      })
      await db.resumeVersion.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.processingRun.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.aiUsage.deleteMany({ where: { ownerUserId: { in: owners } } })
      await db.aiUsageReservation.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.resumeUpload.deleteMany({
        where: { ownerUserId: { in: owners } },
      })
      await db.resume.deleteMany({ where: { ownerUserId: { in: owners } } })
      await db.userProfile.deleteMany({ where: { id: { in: owners } } })
      for (const id of owners)
        execFileSync(
          "neon",
          [
            "neon-auth",
            "user",
            "delete",
            id,
            "--project-id",
            project,
            "--branch",
            branch,
          ],
          { stdio: "ignore" }
        )
    }
    expect(
      await db.userProfile.findMany({
        select: { id: true, createdAt: true },
        orderBy: { id: "asc" },
      })
    ).toEqual(baselineProfiles)
    expect(await db.jobPosting.count()).toBeGreaterThanOrEqual(
      baselinePostingCount.value
    )
    evidence.cleanup = "complete"
    evidence.founderPreserved = true
    evidence.publicPostingsPreserved = true
  } catch (error) {
    evidence.cleanup = "failed"
    evidence.cleanupError = error instanceof Error ? error.message : "unknown"
    throw error
  } finally {
    await persistEvidence()
    s3.destroy()
    await db.$disconnect()
  }
})

async function signup(page: Page, displayName: string) {
  await page.goto("/auth/sign-up")
  const email = `discovery-${randomUUID()}@example.com`
  await page.getByLabel("Name", { exact: true }).fill(displayName)
  await page.getByLabel("Email address").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .click()
  await expect(page).toHaveURL(/\/auth\/verify$/)
  const session = await (await page.request.get("/api/auth/get-session")).json()
  assert.ok(session.user?.id)
  owners.push(session.user.id)
  await db.$executeRaw`UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=${session.user.id} AND email=${email}`
  await page.goto("/onboarding")
  await expect(
    page.getByRole("heading", { name: "Upload your resume." })
  ).toBeVisible()
  return session.user.id as string
}

async function uploadAndConfirm(
  page: Page,
  role: "Software Engineer" | "Product Designer"
): Promise<{ clickedAt: number; clickToCardsMs: number }> {
  const text =
    role === "Software Engineer"
      ? "Alex Example\nalex@example.test\nChicago, IL\nSoftware engineer building reliable systems.\nSkills\nTypeScript, React, PostgreSQL, distributed systems\nExperience\nExample Labs\nSoftware Engineer\nJanuary 2022 - March 2025\nBuilt reliable APIs and accessible product experiences.\nEducation\nExample University\nBS Computer Science\n2018 - 2022"
      : "Alex Example\nalex@example.test\nChicago, IL\nProduct designer building accessible digital products.\nSkills\nFigma, product design, accessibility, design systems, user research\nExperience\nExample Labs\nProduct Designer\nJanuary 2022 - March 2025\nDesigned accessible product experiences and design systems.\nEducation\nExample University\nBA Design\n2018 - 2022"
  await page.getByLabel("Resume file").setInputFiles({
    name: "synthetic-resume.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: resumeDocx(text),
  })
  await page.getByRole("button", { name: "Upload resume", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Review your resume", exact: true })
  ).toBeVisible({ timeout: 120_000 })
  await page.getByRole("checkbox").check()
  await page
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click()
  await expect(page.getByLabel("Target title 1", { exact: true })).toBeVisible()
  await page.getByLabel("Target title 1", { exact: true }).fill(role)
  await page
    .getByRole("button", { name: "More preferences · optional" })
    .click()
  await page
    .getByLabel("Useful skills or keywords")
    .fill(
      role === "Software Engineer"
        ? "TypeScript, React, PostgreSQL"
        : "Figma, accessibility, design systems"
    )
  await page.getByRole("button", { name: "Save preferences" }).click()
  await expect(page.getByRole("status")).toContainText("Preferences saved")
  const clickedAt = Date.now()
  await page
    .getByRole("button", { name: "Find jobs for me", exact: true })
    .click()
  await expect(page).toHaveURL(/\/dashboard\/discover$/)
  await expect(
    page.getByRole("link", { name: "Original posting", exact: true }).first()
  ).toBeVisible({ timeout: 20_000 })
  return { clickedAt, clickToCardsMs: Date.now() - clickedAt }
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
  message: string
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(message)
}

async function jobCard(page: Page, job: { originalUrl: string }) {
  const links = page.getByRole("link", {
    name: "Original posting",
    exact: true,
  })
  for (let index = 0; index < (await links.count()); index++) {
    const link = links.nth(index)
    if ((await link.getAttribute("href")) === job.originalUrl)
      return link.locator("xpath=ancestor::*[@data-slot='card'][1]")
  }
  throw new Error("surfaced job card was not present for the selected filter")
}

async function recordAiEvidence(ownerIds: string[]) {
  const [usage, reservations] = await Promise.all([
    db.aiUsage.findMany({
      where: { ownerUserId: { in: ownerIds } },
      orderBy: { createdAt: "asc" },
    }),
    db.aiUsageReservation.findMany({
      where: { ownerUserId: { in: ownerIds } },
    }),
  ])
  expect(usage.every((row) => ownerIds.includes(row.ownerUserId))).toBe(true)
  const reservationKeys = new Set(
    reservations.map((row) => `${row.ownerUserId}:${row.id}`)
  )
  expect(
    usage.every(
      (row) =>
        row.reservationId === null ||
        reservationKeys.has(`${row.ownerUserId}:${row.reservationId}`)
    )
  ).toBe(true)
  const receipts = usage.map((row) => {
    const metadata = (row.metadata ?? {}) as {
      actualCostUsd?: number | null
      latencyMs?: number | null
      zdr?: boolean
      dataCollection?: string
    }
    return {
      account: ownerIds.indexOf(row.ownerUserId) + 1,
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      status: row.status,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      actualCostUsd:
        typeof metadata.actualCostUsd === "number"
          ? metadata.actualCostUsd
          : null,
      latencyMs: metadata.latencyMs ?? null,
      zdr: metadata.zdr ?? null,
      dataCollection: metadata.dataCollection ?? null,
      costUnknown:
        metadata.actualCostUsd == null ||
        row.costMicroUsd === null ||
        row.status === "reconciliation_required",
    }
  })
  return {
    aiCalls: usage.length,
    provider: [...new Set(usage.map((row) => row.provider))],
    models: [...new Set(usage.map((row) => row.model))],
    tokens: {
      input: usage.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
      output: usage.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    },
    actualCostKnownUsd: receipts.reduce(
      (sum, receipt) => sum + (receipt.actualCostUsd ?? 0),
      0
    ),
    unknownCostCalls: receipts.filter((receipt) => receipt.costUnknown).length,
    receipts,
    usageStatuses: usage.map((row) => row.status),
    reservations: reservations.map((row) => ({
      status: row.status,
      finalCostKnownUsd:
        row.finalCostMicroUsd === null
          ? null
          : Number(row.finalCostMicroUsd) / 1_000_000,
      reservedCeilingUsd: Number(row.reservedCostMicroUsd) / 1_000_000,
    })),
    privateAccounts: ownerIds.map((ownerUserId, index) => {
      const ownerUsage = usage.filter((row) => row.ownerUserId === ownerUserId)
      const ownerReservations = reservations.filter(
        (row) => row.ownerUserId === ownerUserId
      )
      return {
        account: index + 1,
        calls: ownerUsage.length,
        tokens: ownerUsage.reduce(
          (sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
          0
        ),
        knownActualCostUsd: receipts
          .filter(
            (receipt) => receipt.account === index + 1 && !receipt.costUnknown
          )
          .reduce((sum, receipt) => sum + (receipt.actualCostUsd ?? 0), 0),
        unknownCostCalls: receipts.filter(
          (receipt) => receipt.account === index + 1 && receipt.costUnknown
        ).length,
        reservations: ownerReservations.length,
        settledReservations: ownerReservations.filter(
          (row) => row.status === "settled"
        ).length,
      }
    }),
  }
}

test("@discovery-live new users find jobs before following companies and recover durable updates", async ({
  browser,
  page,
  context,
}) => {
  test.setTimeout(600_000)
  const owner = await signup(page, "Discovery first-use engineer")
  const firstUse = await uploadAndConfirm(page, "Software Engineer")
  evidence.latencyMs = {
    clickToFirstDeterministicCards: firstUse.clickToCardsMs,
  }
  await persistEvidence()
  const initialPlan = await waitFor(
    async () =>
      db.processingRun.findFirst({
        where: {
          ownerUserId: owner,
          kind: "discovery_plan_v1",
          status: "succeeded",
        },
        orderBy: { createdAt: "asc" },
        select: { checkpoint: true },
      }),
    120_000,
    "durable initial discovery plan did not finish"
  )
  const zeroWatchCount = await db.companyWatch.count({
    where: { ownerUserId: owner },
  })
  expect(zeroWatchCount).toBe(0)
  await expect(
    page.getByRole("heading", { name: "Discover", exact: true })
  ).toBeVisible()
  const firstDeterministicMs = firstUse.clickToCardsMs
  const firstRead = await (
    await page.request.get("/api/discovery?state=new")
  ).json()
  expect(firstRead.jobs.length).toBeGreaterThan(0)
  expect(firstRead.watches).toHaveLength(0)
  const firstJob = firstRead.jobs[0]
  const firstCard = await jobCard(page, firstJob)
  await firstCard.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("tab", { name: /Saved/ }).click()
  const savedCard = await jobCard(page, firstJob)
  await expect(
    savedCard.getByRole("button", { name: "Unsave", exact: true })
  ).toBeVisible()
  await savedCard
    .getByRole("button", { name: "Track application", exact: true })
    .click()
  await expect(
    (await jobCard(page, firstJob)).getByRole("button", {
      name: "View application",
      exact: true,
    })
  ).toBeVisible()
  const secondJob = firstRead.jobs.find(
    (job: { id: string }) => job.id !== firstJob.id
  )
  assert.ok(secondJob, "shared catalog should provide at least two candidates")
  await page.getByRole("tab", { name: /New/ }).click()
  const secondCard = await jobCard(page, secondJob)
  await secondCard.getByRole("button", { name: "Dismiss", exact: true }).click()

  // Select a surfaced company and make just its shared board due. A single
  // durable shared refresh can then be attributed to this deliberate watch.
  const boardBefore = await db.atsBoard.findUniqueOrThrow({
    where: { id: firstJob.boardId },
  })
  const publicPostingCountBefore = await db.jobPosting.count()
  const storageState = await context.storageState()
  await db.atsBoard.update({
    where: { id: boardBefore.id },
    data: { nextFetchAt: new Date(0) },
  })
  await page.getByRole("tab", { name: /Saved/ }).click()
  const watchCard = await jobCard(page, firstJob)
  const watchStartedAt = Date.now()
  await watchCard
    .getByRole("button", { name: `Watch ${firstJob.company}`, exact: true })
    .click()
  await page.close()
  await context.close()
  const pageClosedAt = new Date()
  await expect
    .poll(
      () =>
        db.atsBoard
          .findUnique({
            where: { id: boardBefore.id },
            select: { fetchCount: true, lastSuccessAt: true },
          })
          .then((b) =>
            b &&
            b.fetchCount > boardBefore.fetchCount &&
            b.lastSuccessAt &&
            b.lastSuccessAt.getTime() >= watchStartedAt
              ? true
              : false
          ),
      { timeout: 30_000 }
    )
    .toBe(true)
  const watchToIngestionMs = Date.now() - watchStartedAt
  expect(watchToIngestionMs).toBeLessThanOrEqual(15_000)
  evidence.latencyMs = {
    ...(evidence.latencyMs as Record<string, number>),
    watchToSharedBoardIngestion: watchToIngestionMs,
  }
  await persistEvidence()
  await waitFor(
    async () => {
      const watch = await db.companyWatch.findUnique({
        where: {
          ownerUserId_boardId: { ownerUserId: owner, boardId: boardBefore.id },
        },
      })
      return watch ? true : null
    },
    10_000,
    "new company watch was not persisted"
  )
  const stateAfterSave = await db.userJobState.findUnique({
    where: {
      ownerUserId_jobPostingId: {
        ownerUserId: owner,
        jobPostingId: firstJob.id,
      },
    },
  })
  expect(stateAfterSave?.state).toBe("saved")
  const tracked = await db.application.findFirst({
    where: { ownerUserId: owner, sourcePostingKey: firstJob.id },
  })
  expect(tracked).toBeTruthy()
  const dismissedState = secondJob
    ? await db.userJobState.findUnique({
        where: {
          ownerUserId_jobPostingId: {
            ownerUserId: owner,
            jobPostingId: secondJob.id,
          },
        },
      })
    : null
  expect(dismissedState?.state).toBe("dismissed")
  const aiMatch = await waitFor(
    async () =>
      db.jobMatch.findFirst({
        where: {
          ownerUserId: owner,
          aiAnalyzedAt: { gte: pageClosedAt },
          aiScore: { not: null },
        },
        orderBy: { aiAnalyzedAt: "asc" },
        select: { aiAnalyzedAt: true, jobPostingId: true },
      }),
    90_000,
    "no AI-enhanced match completed while the page was away"
  )
  const matchReceipt = await db.aiUsage.findFirstOrThrow({
    where: {
      ownerUserId: owner,
      feature: "job_match_v1",
      status: "succeeded",
    },
    orderBy: { createdAt: "asc" },
  })
  expect(matchReceipt.provider).toBe("openrouter")
  expect(matchReceipt.model).toBe(MATCH_AI_CONFIG.model)
  expect(matchReceipt.reservationId).toBeTruthy()
  expect((matchReceipt.metadata as { zdr?: boolean } | null)?.zdr).toBe(true)
  expect(
    (matchReceipt.metadata as { dataCollection?: string } | null)
      ?.dataCollection
  ).toBe("deny")
  const firstAiMatch = await db.jobMatch.findFirstOrThrow({
    where: { ownerUserId: owner, aiAnalyzedAt: { not: null } },
    orderBy: { aiAnalyzedAt: "asc" },
    select: { aiAnalyzedAt: true },
  })
  const clickToAiMs = firstAiMatch.aiAnalyzedAt!.getTime() - firstUse.clickedAt
  evidence.latencyMs = {
    ...(evidence.latencyMs as Record<string, number>),
    clickToFirstAiEnhanced: clickToAiMs,
  }
  evidence.firstAiAnalyzedAt = firstAiMatch.aiAnalyzedAt
  evidence.enhancedAfterBrowserClosedAt = aiMatch.aiAnalyzedAt
  evidence.ai = await recordAiEvidence([owner])
  evidence.durableAfterPageClosed = true
  await persistEvidence()
  const returnedContext = await browser.newContext({ storageState })
  const returnedPage = await returnedContext.newPage()
  await returnedPage.goto("/dashboard")
  await returnedPage.goto("/dashboard/discover")
  await expect(
    returnedPage.getByRole("heading", { name: "Discover", exact: true })
  ).toBeVisible()
  const enhancedResult = await (async () => {
    for (const state of ["new", "saved", "dismissed"] as const) {
      const data = await (
        await returnedPage.request.get(`/api/discovery?state=${state}`)
      ).json()
      const job = data.jobs.find(
        (candidate: { aiScore: number | null }) => candidate.aiScore !== null
      )
      if (job) return { state, job }
    }
    return null
  })()
  assert.ok(enhancedResult, "no current AI-enhanced result was returned")
  if (enhancedResult.state !== "new")
    await returnedPage
      .getByRole("tab", { name: new RegExp(enhancedResult.state, "i") })
      .click()
  const enhancedCard = await jobCard(returnedPage, enhancedResult.job)
  await expect(enhancedCard.getByText(/AI match · \d+\/100/)).toBeVisible()
  await returnedPage.getByRole("tab", { name: /Saved/ }).click()
  const returnedSavedCard = await jobCard(returnedPage, firstJob)
  await expect(returnedSavedCard).toBeVisible()
  await expect(
    returnedSavedCard.getByRole("button", {
      name: "View application",
      exact: true,
    })
  ).toBeVisible()
  await returnedPage.getByRole("tab", { name: /Dismissed/ }).click()
  await expect(await jobCard(returnedPage, secondJob)).toBeVisible()
  await returnedPage.close()
  await returnedContext.close()

  // A second account with a different confirmed role receives independent
  // matches over the same public catalog rows.
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  const secondOwner = await signup(secondPage, "Discovery first-use designer")
  const secondUse = await uploadAndConfirm(secondPage, "Product Designer")
  await expect(
    secondPage
      .getByRole("link", { name: "Original posting", exact: true })
      .first()
  ).toBeVisible({ timeout: 20_000 })
  const secondRead = await (
    await secondPage.request.get("/api/discovery?state=new")
  ).json()
  expect(secondRead.jobs.length).toBeGreaterThan(0)
  const matchCounts = await db.jobMatch.groupBy({
    by: ["ownerUserId"],
    where: { ownerUserId: { in: [owner, secondOwner] } },
    _count: { _all: true },
  })
  expect(matchCounts.map((row) => row.ownerUserId).sort()).toEqual(
    [owner, secondOwner].sort()
  )
  const ownerInput = await db.jobMatch.findFirstOrThrow({
    where: { ownerUserId: owner },
    select: { preferenceHash: true },
  })
  const secondInput = await db.jobMatch.findFirstOrThrow({
    where: { ownerUserId: secondOwner },
    select: { preferenceHash: true },
  })
  expect(ownerInput.preferenceHash).not.toBe(secondInput.preferenceHash)
  const postingCounts = await db.jobPosting.count()
  expect(postingCounts).toBeGreaterThanOrEqual(publicPostingCountBefore)
  const duplicatePostingKeys = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) AS count FROM (SELECT "boardId", "externalId" FROM "JobPosting" GROUP BY "boardId", "externalId" HAVING count(*) > 1) duplicates`
  expect(Number(duplicatePostingKeys[0]?.count ?? 0)).toBe(0)

  // Changing preferences keeps actions and applications while old matches no
  // longer appear as current; the confirmed resume identity stays explicit.
  const revisionBefore = await db.userProfile.findUniqueOrThrow({
    where: { id: owner },
    select: { preferenceRevision: true },
  })
  await returnedContext.close().catch(() => {})
  const proofContext = await browser.newContext({ storageState })
  const proofPage = await proofContext.newPage()
  await proofPage.goto("/dashboard/discover")
  await proofPage
    .getByRole("button", { name: "Refine search", exact: true })
    .click()
  await proofPage
    .getByLabel("Target titles · one per line")
    .fill("Senior Software Engineer")
  await proofPage
    .getByRole("button", { name: "Save preferences", exact: true })
    .click()
  await expect(
    proofPage.getByRole("button", { name: "Refresh matches", exact: true })
  ).toBeVisible()
  expect(
    (
      await db.userProfile.findUniqueOrThrow({
        where: { id: owner },
        select: { preferenceRevision: true },
      })
    ).preferenceRevision
  ).toBeGreaterThan(revisionBefore.preferenceRevision)
  const staleAfterPreferences = await (
    await proofPage.request.get("/api/discovery?state=saved")
  ).json()
  expect(
    staleAfterPreferences.jobs.find(
      (job: { id: string }) => job.id === firstJob.id
    )?.stale
  ).toBe(true)
  expect(
    (
      await db.userJobState.findUniqueOrThrow({
        where: {
          ownerUserId_jobPostingId: {
            ownerUserId: owner,
            jobPostingId: firstJob.id,
          },
        },
        select: { state: true },
      })
    ).state
  ).toBe("saved")
  expect(
    await db.application.findFirst({
      where: { ownerUserId: owner, sourcePostingKey: firstJob.id },
    })
  ).toBeTruthy()
  const confirmedBeforeEdit = await db.resume.findFirstOrThrow({
    where: { ownerUserId: owner },
    select: { confirmedVersionId: true },
  })
  await proofPage.goto("/dashboard/resume")
  await proofPage
    .getByLabel("Summary", { exact: true })
    .fill(
      "Software engineer building reliable, accessible systems and products."
    )
  await proofPage
    .getByRole("button", { name: "Save changes", exact: true })
    .click()
  await expect(
    proofPage.getByText("Saved as version 2.", { exact: false })
  ).toBeVisible()
  await proofPage.getByRole("checkbox").check()
  await proofPage
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click()
  await expect(
    proofPage.getByRole("heading", { name: "Your resume.", exact: true })
  ).toBeVisible()
  const savedAfterResumeChange = await (
    await proofPage.request.get("/api/discovery?state=saved")
  ).json()
  expect(
    savedAfterResumeChange.jobs.find(
      (job: { id: string }) => job.id === firstJob.id
    )?.stale
  ).toBe(true)
  expect(
    (
      await db.resume.findFirstOrThrow({
        where: { ownerUserId: owner },
        select: { confirmedVersionId: true },
      })
    ).confirmedVersionId
  ).not.toBe(confirmedBeforeEdit.confirmedVersionId)
  expect(
    await db.userJobState.findUniqueOrThrow({
      where: {
        ownerUserId_jobPostingId: {
          ownerUserId: owner,
          jobPostingId: secondJob.id,
        },
      },
      select: { state: true },
    })
  ).toMatchObject({ state: "dismissed" })
  await proofContext.close()

  const ai = await recordAiEvidence(owners)
  const boardAfter = await db.atsBoard.findUniqueOrThrow({
    where: { id: boardBefore.id },
  })
  const considered = await db.jobPosting.count({
    where: { open: true, board: freshBoardFilter() },
  })
  evidence.latencyMs = {
    clickToFirstDeterministicCards: firstDeterministicMs,
    clickToFirstAiEnhanced: clickToAiMs,
    watchToSharedBoardIngestion: watchToIngestionMs,
    secondAccountClickToCards: secondUse.clickToCardsMs,
  }
  evidence.catalog = {
    freshOpenPostingsConsidered:
      (initialPlan.checkpoint as { considered?: number } | null)?.considered ??
      considered,
    freshCatalogPostingsAvailable:
      (initialPlan.checkpoint as { catalogPostings?: number } | null)
        ?.catalogPostings ?? considered,
    deterministicCandidatesForFirstUser: await db.jobMatch.count({
      where: { ownerUserId: owner },
    }),
    secondUserCandidates: await db.jobMatch.count({
      where: { ownerUserId: secondOwner },
    }),
    publicPostingRowsBeforeWatch: publicPostingCountBefore,
    publicPostingRowsAfter: postingCounts,
    sharedBoardFetchesForWatchedCompany:
      boardAfter.fetchCount - boardBefore.fetchCount,
    duplicateBoardExternalIds: Number(duplicatePostingKeys[0]?.count ?? 0),
  }
  evidence.ai = ai
  evidence.firstAiAnalyzedAt = firstAiMatch.aiAnalyzedAt
  evidence.actions = {
    saved: true,
    tracked: true,
    dismissed: !!secondJob,
    watchPersisted: true,
  }
  evidence.staleInputRevisionAdvanced = true
  evidence.confirmedResumeChangeMarkedPriorMatchStale = true
  evidence.durableAfterPageClosed = true
  await secondContext.close()
})
