import { test, expect, type Page } from "@playwright/test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createDatabaseClient } from "../../lib/backend/create-db-client"
import { sanitizedResume } from "../resume-structure-fixtures"

const project = "lively-shape-65452824"
const branch = "br-tiny-tree-b44fo1lv"
const db = createDatabaseClient(process.env.DATABASE_URL!)
const users: string[] = []
const password = `Applications-proof-${randomUUID()}!`
let baselineProfiles: { id: string; createdAt: Date }[] = []
let baselinePostingCount = 0
let fixturePostingSnapshot: {
  id: string
  contentHash: string
  open: boolean
} | null = null

async function aiEvidence(ownerIds: string[]) {
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
    }
    return {
      owner: ownerIds.indexOf(row.ownerUserId) + 1,
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      status: row.status,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      actualCostUsd: metadata.actualCostUsd ?? null,
      latencyMs: metadata.latencyMs ?? null,
      costUnknown:
        metadata.actualCostUsd == null ||
        row.costMicroUsd === null ||
        row.status === "reconciliation_required",
    }
  })
  return {
    calls: usage.length,
    resumeAiCalls: usage.filter((row) => row.feature === "resume_structure_v1")
      .length,
    matchAiCalls: usage.filter((row) => row.feature === "job_match_v1").length,
    tokens: {
      input: usage.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
      output: usage.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    },
    knownActualCostUsd: receipts.reduce(
      (sum, receipt) => sum + (receipt.actualCostUsd ?? 0),
      0
    ),
    unknownCostCalls: receipts.filter((receipt) => receipt.costUnknown).length,
    reservations: reservations.map((row) => ({
      status: row.status,
      reservedCeilingUsd: Number(row.reservedCostMicroUsd) / 1_000_000,
      finalCostUsd:
        row.finalCostMicroUsd === null
          ? null
          : Number(row.finalCostMicroUsd) / 1_000_000,
    })),
    receipts,
  }
}

async function waitForWorkers(ownerIds: string[]) {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const now = new Date()
    // Canceled invocations may retain their lease until expiry. Reap only this
    // fixture's canceled rows after that durable lease has elapsed.
    await db.processingRun.updateMany({
      where: {
        ownerUserId: { in: ownerIds },
        status: "running",
        cancellationRequestedAt: { not: null },
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: "canceled",
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: now,
      },
    })
    if (
      (await db.processingRun.count({
        where: { ownerUserId: { in: ownerIds }, status: "running" },
      })) === 0
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error("fixture discovery workers did not quiesce for cleanup")
}

test.beforeAll(async () => {
  assert.ok(
    new URL(process.env.DATABASE_URL!).hostname.startsWith(
      "ep-green-scene-b45djevq"
    ),
    "browser tests require the isolated branch"
  )
  baselineProfiles = await db.userProfile.findMany({
    select: { id: true, createdAt: true },
    orderBy: { id: "asc" },
  })
  baselinePostingCount = await db.jobPosting.count()
})

test.afterAll(async () => {
  let matchAiCalls = 0
  try {
    assert.ok(
      users.every((id) => !baselineProfiles.some((p) => p.id === id)),
      "only fixture users can be removed"
    )
    if (users.length) {
      const now = new Date()
      await db.userProfile.updateMany({
        where: { id: { in: users } },
        data: { deletionRequestedAt: now },
      })
      await db.processingRun.updateMany({
        where: {
          ownerUserId: { in: users },
          status: { in: ["pending", "retry_wait"] },
        },
        data: { status: "canceled", cancellationRequestedAt: now },
      })
      await db.processingRun.updateMany({
        where: { ownerUserId: { in: users }, status: "running" },
        data: { cancellationRequestedAt: now },
      })
      await waitForWorkers(users)
      const evidence = await aiEvidence(users)
      expect(evidence.resumeAiCalls).toBe(0)
      matchAiCalls = evidence.matchAiCalls
      console.log(JSON.stringify({ aiUsage: evidence }))
      await db.application.deleteMany({ where: { ownerUserId: { in: users } } })
      await db.userJobState.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.processingRun.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.jobMatch.deleteMany({ where: { ownerUserId: { in: users } } })
      await db.companyWatch.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.discoveryAllowance.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.aiUsage.deleteMany({ where: { ownerUserId: { in: users } } })
      await db.aiUsageReservation.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.targetPreference.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.resume.updateMany({
        where: { ownerUserId: { in: users } },
        data: { confirmedVersionId: null, confirmedAt: null },
      })
      await db.resumeVersion.deleteMany({
        where: { ownerUserId: { in: users } },
      })
      await db.resume.deleteMany({ where: { ownerUserId: { in: users } } })
      await db.userProfile.deleteMany({ where: { id: { in: users } } })
      for (const id of users)
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
    const afterCount = await db.jobPosting.count()
    const fixtureAfter = fixturePostingSnapshot
      ? await db.jobPosting.findUnique({
          where: { id: fixturePostingSnapshot.id },
          select: { id: true, contentHash: true, open: true },
        })
      : null
    // Live catalog refresh may change the total during a long proof. The fixture
    // itself must preserve its public posting identity and captured content state.
    expect(afterCount).toBeGreaterThanOrEqual(baselinePostingCount)
    if (fixturePostingSnapshot)
      expect(fixtureAfter).toEqual(fixturePostingSnapshot)
    console.log(
      JSON.stringify({
        cleanup: "complete",
        publicPostingsPreserved: true,
        founderPreserved: true,
        zeroResumeAiCalls: true,
        matchAiCalls,
        temporaryAuthUsers: users.length,
      })
    )
  } finally {
    await db.$disconnect()
  }
})

async function signup(page: Page) {
  await page.goto("/auth/sign-up")
  await page
    .getByLabel("Name", { exact: true })
    .fill("Applications isolated proof")
  const email = `applications-${randomUUID()}@example.com`
  await page.getByLabel("Email address").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .click()
  await expect(page).toHaveURL(/\/auth\/verify$/)
  const session = await (await page.request.get("/api/auth/get-session")).json()
  users.push(session.user.id)
  // Admin-only activation fixture, scoped to this new session and unique email.
  await db.$executeRaw`UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=${session.user.id} AND email=${email}`
  await page.goto("/onboarding")
  return session.user.id as string
}

async function seed(owner: string) {
  const now = new Date()
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: "Synthetic confirmed resume" },
  })
  const version = await db.resumeVersion.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      version: 1,
      source: "manual",
      status: "ready",
      data: sanitizedResume,
    },
  })
  await db.targetPreference.create({
    data: {
      ownerUserId: owner,
      targetTitle: "Software Engineer",
      keywords: ["TypeScript", "PostgreSQL"],
    },
  })
  await db.$transaction([
    db.resume.update({
      where: { id: resume.id },
      data: { confirmedVersionId: version.id, confirmedAt: now },
    }),
    db.userProfile.update({
      where: { id: owner },
      data: {
        displayName: "Applications isolated proof",
        onboardingCompletedAt: now,
        preferenceRevision: 1,
      },
    }),
  ])
  // Finding should create this user's private deterministic match from the
  // shared catalog. No company watch or seeded match is needed.
}

async function jobCard(page: Page, posting: { originalUrl: string }) {
  const link = page
    .getByRole("button", { name: "Original posting", exact: true })
    .and(page.locator(`[href=${JSON.stringify(posting.originalUrl)}]`))
  await expect(link).toBeVisible()
  return link.locator("xpath=ancestor::*[@data-slot='card'][1]")
}

async function applications(page: Page) {
  const response = await page.request.get("/api/applications")
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<{
    applications: Array<{
      id: string
      title: string
      company: string
      status: string
      stageName: string | null
      revision: number
      archivedAt: string | null
      events: unknown[]
    }>
  }>
}

test("applications conversion and private lifecycle stay durable and isolated", async ({
  page,
  context,
  browser,
}) => {
  const owner = await signup(page)
  await seed(owner)

  await page.goto("/dashboard/discover")
  expect(await db.companyWatch.count({ where: { ownerUserId: owner } })).toBe(0)
  const initialData = await (await page.request.get("/api/discovery")).json()
  expect(initialData.jobs.length).toBeGreaterThan(0)
  const selectedResult = initialData.jobs[0]
  const posting = await db.jobPosting.findUniqueOrThrow({
    where: { id: selectedResult.id },
    include: { board: { include: { company: true } } },
  })
  fixturePostingSnapshot = {
    id: posting.id,
    contentHash: posting.contentHash,
    open: posting.open,
  }
  expect(
    await db.aiUsage.count({
      where: { ownerUserId: owner, feature: "resume_structure_v1" },
    })
  ).toBe(0)
  expect(await db.companyWatch.count({ where: { ownerUserId: owner } })).toBe(0)

  const card = await jobCard(page, posting)
  await expect(card).toBeVisible()
  await expect(
    card.getByText("Matches your search", { exact: true })
  ).toBeVisible()
  await expect(
    card
      .getByText("Why this is worth a look", { exact: true })
      .or(card.getByText(/^AI match · \d+\/100/))
  ).toBeVisible()
  await expect
    .poll(
      () =>
        db.jobMatch.count({
          where: { ownerUserId: owner, aiScore: { not: null } },
        }),
      { timeout: 90_000, intervals: [500, 1000, 2000, 3000] }
    )
    .toBeGreaterThan(0)
  await page
    .getByRole("button", { name: "Refresh matches", exact: true })
    .click()
  await expect(page.getByText(/^AI match · \d+\/100/).first()).toBeVisible({
    timeout: 30_000,
  })
  const match = await db.jobMatch.findFirstOrThrow({
    where: { ownerUserId: owner, jobPostingId: posting.id },
    orderBy: { createdAt: "desc" },
  })
  const trackInput = {
    action: "track",
    postingId: posting.id,
    matchId: match.id,
  }
  const trackResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/applications") &&
      response.request().method() === "POST"
  )
  await card
    .getByRole("button", { name: "Track application", exact: true })
    .click()
  const trackResponse = await trackResponsePromise
  expect(trackResponse.status()).toBe(200)
  await expect
    .poll(() =>
      db.application.count({
        where: { ownerUserId: owner, sourcePostingKey: posting.id },
      })
    )
    .toBe(1)
  const initialApps = await applications(page)
  const trackedId = initialApps.applications.find(
    (a) => a.status === "saved"
  )?.id
  assert.ok(
    trackedId,
    "Discover should convert the saved match into an application"
  )
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () =>
      page.request.post("/api/applications", { data: trackInput })
    )
  )
  for (const response of concurrent) expect(response.ok()).toBeTruthy()
  const converted = await Promise.all(concurrent.map((r) => r.json()))
  expect(converted.filter((r) => r.created).length).toBe(0)
  expect(new Set(converted.map((r) => r.applicationId)).size).toBe(1)
  expect(converted[0].applicationId).toBe(trackedId)
  expect(
    await db.application.count({
      where: { ownerUserId: owner, sourcePostingKey: posting.id },
    })
  ).toBe(1)
  await page.goto(`/dashboard/jobs?application=${trackedId}`)
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByText("From Discover", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Why Discover surfaced this job", { exact: true })
  ).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1")
  await page.screenshot({
    path: "output/playwright/application-detail-desktop.png",
    fullPage: true,
    animations: "disabled",
  })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // Keyboard opens the application detail and the status menu; the form save is also
  // submitted from the keyboard to cover the accessible interaction path.
  const open = page.getByRole("button", {
    name: `Open ${posting.title} at ${posting.board.company.name}`,
  })
  await open.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Record movement" }).focus()
  await page.keyboard.press("Enter")
  const status = page.getByLabel("Status", { exact: true })
  await status.focus()
  await page.keyboard.press("Enter")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  // Movement requires a calendar date; use the application API's server-provided today.
  const appData = await (await page.request.get("/api/applications")).json()
  await page.getByLabel("Movement date", { exact: true }).fill(appData.today)
  await page
    .getByLabel("Stage name · optional", { exact: true })
    .fill("Recruiter screen")
  await page.getByRole("button", { name: "Save movement", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByText(/Saved \/ Preparing → Applied · Recruiter screen/)
  ).toBeVisible()

  await page.getByRole("button", { name: "Record movement" }).click()
  const interviewStatus = page.getByLabel("Status", { exact: true })
  await interviewStatus.click()
  await page.getByRole("option", { name: "Interview", exact: true }).click()
  await page
    .getByLabel("Stage name · optional", { exact: true })
    .fill("Technical interview")
  await page.getByRole("button", { name: "Save movement", exact: true }).click()
  await expect(
    page.getByText(/Applied → Interview · Technical interview/)
  ).toBeVisible()
  const historyData = await applications(page)
  const tracked = historyData.applications.find((a) => a.id === trackedId)
  expect(tracked?.status).toBe("interview")
  expect(tracked?.stageName).toBe("Technical interview")
  expect(tracked?.events).toHaveLength(3)
  expect(tracked?.revision).toBe(2)
  await page.reload()
  await expect(
    page.getByText(/Applied → Interview · Technical interview/)
  ).toBeVisible()

  // A second browser tab retains its local draft on conflict, then can load the latest
  // server version explicitly.
  const stale = await context.newPage()
  await stale.goto(`/dashboard/jobs?application=${trackedId}`)
  await stale.getByRole("button", { name: "Edit details" }).click()
  await stale
    .getByLabel("Company", { exact: true })
    .fill("Unsaved local company")
  await page.getByRole("button", { name: "Edit details" }).click()
  await page.getByLabel("Company", { exact: true }).fill("Updated company")
  await page.getByRole("button", { name: "Save details", exact: true }).click()
  await stale.getByRole("button", { name: "Save details", exact: true }).click()
  await expect(stale.getByRole("alert")).toContainText("changed in another tab")
  await expect(stale.getByLabel("Company", { exact: true })).toHaveValue(
    "Unsaved local company"
  )
  await stale
    .getByRole("button", { name: "Discard local edits & load latest" })
    .click()
  await stale.getByRole("button", { name: "Edit details" }).click()
  await expect(stale.getByLabel("Company", { exact: true })).toHaveValue(
    "Updated company"
  )
  await stale.close()

  // Manual entries coexist with converted postings and can be archived/restored/deleted.
  await page.goto("/dashboard/jobs")
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click()
  await page
    .getByLabel("Company", { exact: true })
    .fill("Manual Fixture Studio")
  await page.getByLabel("Job title", { exact: true }).fill("Product Engineer")
  const today = (await (await page.request.get("/api/applications")).json())
    .today as string
  await page
    .getByLabel("Next action · optional", { exact: true })
    .fill("Send a tailored introduction")
  await page
    .getByLabel("Follow-up date · optional", { exact: true })
    .fill(today)
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .last()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByText("Added manually", { exact: true })).toBeVisible()
  const manualId = (await applications(page)).applications.find(
    (a) =>
      a.title === "Product Engineer" && a.company === "Manual Fixture Studio"
  )?.id
  assert.ok(manualId)
  await page.keyboard.press("Escape")
  await page.goto("/dashboard")
  await expect(page.getByText(/1 follow-ups? due/)).toBeVisible()
  await expect(
    page.getByText("Send a tailored introduction", { exact: true })
  ).toBeVisible()
  await expect(page.getByText(/Technical interview/)).toBeVisible()
  await expect(
    page.getByText("Active applications", { exact: true }).locator("..")
  ).toContainText("2")
  await expect(
    page.getByText("In interviews", { exact: true }).locator("..")
  ).toContainText("1")
  await page.screenshot({
    path: "output/playwright/application-dashboard-desktop.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "output/playwright/application-dashboard-mobile.png",
    fullPage: true,
  })
  await page.goto(`/dashboard/jobs?application=${manualId}`)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Archive application" }).click()
  await page.getByRole("button", { name: "Confirm archive" }).click()
  await expect(
    page.getByText("Archived", { exact: true }).first()
  ).toBeVisible()
  await page.getByRole("button", { name: "Restore application" }).click()
  await page.keyboard.press("Escape")
  await page.getByLabel("Show").click()
  await page.getByRole("option", { name: "Archived", exact: true }).click()
  await expect(page.getByText("Product Engineer", { exact: true })).toHaveCount(
    0
  )
  await page.getByLabel("Show").click()
  await page
    .getByRole("option", { name: "All applications", exact: true })
    .click()
  await expect(
    page.getByRole("button", {
      name: "Open Product Engineer at Manual Fixture Studio",
    })
  ).toBeVisible()
  await page.goto(`/dashboard/jobs?application=${manualId}`)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Archive application" }).click()
  await page.getByRole("button", { name: "Confirm archive" }).click()
  await page.goto(`/dashboard/jobs?application=${manualId}`)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Delete application" }).click()
  await page.getByRole("button", { name: "Delete permanently" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  const secondContext = await browser.newContext({
    baseURL: process.env.JOBSYNC_BROWSER_ORIGIN ?? "http://localhost:3000",
  })
  try {
    const otherPage = await secondContext.newPage()
    const otherOwner = await signup(otherPage)
    await db.userProfile.update({
      where: { id: otherOwner },
      data: { onboardingCompletedAt: new Date() },
    })
    expect((await applications(otherPage)).applications).toEqual([])
    const foreignDetails = {
      company: "Foreign attempt",
      title: "Foreign title",
      location: "",
      postingUrl: null,
      salary: null,
      notes: null,
      appliedOn: null,
      followUpOn: null,
      nextAction: null,
      resumeVersionId: null,
    }
    for (const action of [
      {
        action: "edit",
        applicationId: trackedId,
        expectedRevision: 0,
        details: foreignDetails,
      },
      {
        action: "archive",
        applicationId: trackedId,
        expectedRevision: 0,
        archived: true,
      },
      { action: "delete", applicationId: trackedId, expectedRevision: 0 },
      trackInput,
    ]) {
      expect(
        (
          await otherPage.request.post("/api/applications", { data: action })
        ).status()
      ).toBe(404)
    }
    expect(
      (await applications(page)).applications.find((a) => a.id === trackedId)
        ?.status
    ).toBe("interview")
    console.log(
      JSON.stringify({
        secondUserIsolation: true,
        foreignApplicationWrites: "404",
        applicationsVisible: 0,
      })
    )
  } finally {
    await secondContext.close()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  expect(
    (await applications(page)).applications.some((a) => a.id === trackedId)
  ).toBe(true)
  expect(
    (await db.application.findUnique({ where: { id: trackedId } }))
      ?.resumeVersionId
  ).toBeNull()
})
