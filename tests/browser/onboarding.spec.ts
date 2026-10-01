import { test, expect, type Page, type BrowserContext } from "@playwright/test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { createDatabaseClient } from "../../lib/backend/create-db-client"
import { createStorageClient } from "../../lib/backend/create-storage-client"
import { resumeDocx, sanitizedResume } from "../resume-structure-fixtures"

const project = "lively-shape-65452824"
const branch = "br-tiny-tree-b44fo1lv"
const db = createDatabaseClient(process.env.DATABASE_URL!)
const users: string[] = []
const password = `Isolated-proof-${randomUUID()}!`
let baseline: unknown

test.beforeAll(async () => {
  assert.ok(
    new URL(process.env.DATABASE_URL!).hostname.startsWith(
      "ep-green-scene-b45djevq"
    ),
    "browser tests require the isolated branch"
  )
  baseline = await db.userProfile.findMany({
    select: { id: true, createdAt: true },
    orderBy: { id: "asc" },
  })
})
test.afterAll(async () => {
  const s3 = createStorageClient({
    endpoint: process.env.AWS_ENDPOINT_URL_S3!,
    region: process.env.AWS_REGION!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  })
  try {
    for (const upload of await db.resumeUpload.findMany({
      where: { ownerUserId: { in: users } },
    })) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: "jobsync-files",
          Key: upload.objectKey,
        })
      )
    }
    await db.resume.updateMany({
      where: { ownerUserId: { in: users } },
      data: { confirmedVersionId: null, confirmedAt: null },
    })
    await db.targetPreference.deleteMany({
      where: { ownerUserId: { in: users } },
    })
    await db.resumeVersion.deleteMany({
      where: { ownerUserId: { in: users }, originDraftId: { not: null } },
    })
    await db.resumeVersion.deleteMany({ where: { ownerUserId: { in: users } } })
    await db.aiUsage.deleteMany({ where: { ownerUserId: { in: users } } })
    await db.aiUsageReservation.deleteMany({
      where: { ownerUserId: { in: users } },
    })
    await db.processingRun.deleteMany({ where: { ownerUserId: { in: users } } })
    await db.resumeUpload.deleteMany({ where: { ownerUserId: { in: users } } })
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
    expect(
      await db.userProfile.findMany({
        select: { id: true, createdAt: true },
        orderBy: { id: "asc" },
      })
    ).toEqual(baseline)
    console.log(
      JSON.stringify({
        cleanup: "complete",
        founderPreserved: true,
        temporaryAuthUsers: users.length,
      })
    )
  } finally {
    s3.destroy()
    await db.$disconnect()
  }
})
async function signup(page: Page) {
  await page.goto("/auth/sign-up")
  await page.getByLabel("Name", { exact: true }).fill("JobSync isolated proof")
  const email = `jobsync-browser-${randomUUID()}@example.com`
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
  await expect(
    page.getByRole("heading", { name: "Upload your resume." })
  ).toBeVisible()
  return session.user.id as string
}
async function state(page: Page) {
  return (await page.request.get("/api/onboarding")).json()
}
async function seededDraft(owner: string) {
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: "Sanitized fixture" },
  })
  const upload = await db.resumeUpload.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      objectKey: `browser-fixture/${randomUUID()}`,
      originalFileName: "sanitized.docx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      declaredSizeBytes: 128,
      status: "uploaded",
      actualContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      actualSizeBytes: BigInt(128),
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      validationCompletedAt: new Date(),
      detectedFormat: "docx",
      contentSha256: "a".repeat(64),
    },
  })
  const run = await db.processingRun.create({
    data: {
      ownerUserId: owner,
      kind: "resume_structure_v1",
      resourceId: upload.id,
      idempotencyKey: `browser-fixture:${randomUUID()}`,
      status: "succeeded",
    },
  })
  await db.resumeVersion.create({
    data: {
      ownerUserId: owner,
      resumeId: resume.id,
      version: 1,
      source: "upload",
      status: "draft",
      sourceUploadId: upload.id,
      sourceSha256: upload.contentSha256,
      processingRunId: run.id,
      promptVersion: "fixture",
      extractionVersion: "fixture",
      schemaVersion: "resume-v1",
      data: sanitizedResume,
    },
  })
}
async function directRoutes(page: Page, expected: RegExp) {
  for (const route of ["/dashboard", "/dashboard/resume"]) {
    await page.goto(route)
    await expect(page).toHaveURL(
      route === "/dashboard" ? /\/dashboard$/ : expected
    )
  }
}
async function resumeAndPreferences(
  page: Page,
  context: BrowserContext,
  owner: string,
  live: boolean
) {
  await expect(
    page.getByRole("heading", { name: "Review your resume", exact: true })
  ).toBeVisible({ timeout: 120000 })
  const before = await state(page)
  const usageBefore = await db.aiUsage.count({ where: { ownerUserId: owner } })
  expect(usageBefore).toBe(live ? 1 : 0)
  expect(before.version.confirmed).toBe(false)
  await expect(
    page.getByRole("button", { name: "Confirm resume", exact: true })
  ).toBeDisabled()
  await directRoutes(page, /\/onboarding$/)
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Alex Example"
  )
  await page.reload()
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Alex Example"
  )
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible()
  await page.screenshot({
    path: "output/playwright/resume-review-desktop.png",
    fullPage: true,
  })

  const stale = await context.newPage()
  await stale.goto("/onboarding")
  await expect(stale.getByLabel("Phone", { exact: true })).toBeVisible()
  await page.getByLabel("Phone", { exact: true }).fill("312-555-0184")
  await page
    .getByLabel("Summary", { exact: true })
    .fill("Software engineer focused on reliable, accessible systems.")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByText("Saved as version 2.", { exact: false })
  ).toBeVisible()
  await stale.getByLabel("Phone", { exact: true }).fill("stale-tab-value")
  await stale.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    stale.getByRole("alert").filter({ hasText: "Newer changes are saved" })
  ).toContainText("changed in another tab or device")
  await expect(stale.getByLabel("Phone", { exact: true })).toHaveValue(
    "stale-tab-value"
  )
  await stale
    .getByRole("button", { name: "Discard local edits & load latest" })
    .click()
  await expect(stale.getByLabel("Phone", { exact: true })).toHaveValue(
    "312-555-0184"
  )
  await stale.close()

  await page.getByRole("tab", { name: "Employment", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByLabel("Employer", { exact: true })).toHaveValue(
    "Example Labs"
  )
  await page
    .getByLabel("Job title", { exact: true })
    .fill("Senior Software Engineer")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(
    page.getByText("Saved as version 3.", { exact: false })
  ).toBeVisible()
  await page.getByRole("tab", { name: "Education", exact: true }).click()
  await expect(page.getByLabel("Institution", { exact: true })).toHaveValue(
    "Example University"
  )
  await page.getByRole("tab", { name: "Credentials", exact: true }).click()
  await expect(page.getByLabel("Credential or certification")).toHaveValue(
    "Example Certificate"
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "Contact & overview" }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "output/playwright/resume-review-mobile.png",
    fullPage: true,
  })
  await page.getByRole("checkbox").focus()
  await page.keyboard.press("Space")
  await expect(page.getByRole("checkbox")).toBeChecked()
  await page
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click()
  await expect(page.getByLabel("Target title 1", { exact: true })).toBeVisible()
  const confirmed = await state(page)
  expect(confirmed.version.confirmed).toBe(true)
  expect(confirmed.completedAt).toBe(null)
  await directRoutes(page, /\/onboarding$/)
  await expect(page.getByLabel("Target title 1", { exact: true })).toBeVisible()
  await page
    .getByLabel("Target title 1", { exact: true })
    .fill("Backend Engineer")
  await page.getByRole("button", { name: "Back to resume" }).click()
  await page.getByRole("button", { name: "Find jobs for me" }).click()
  await expect(page.getByLabel("Target title 1", { exact: true })).toHaveValue(
    "Backend Engineer"
  )
  await page.getByRole("button", { name: "Add another role" }).click()
  await page
    .getByLabel("Target title 2", { exact: true })
    .fill("Platform Engineer")
  await page
    .getByRole("button", { name: "More preferences · optional" })
    .click()
  await page.getByLabel("Locations", { exact: true }).fill("Chicago, Austin")
  await page.getByRole("radio", { name: "Prefer remote", exact: true }).click()
  await page.getByLabel("Minimum annual salary · USD").fill("95000")
  await page
    .getByLabel("Useful skills or keywords")
    .fill("TypeScript, PostgreSQL")
  await page.getByRole("button", { name: "Save preferences" }).click()
  await expect(page.getByRole("status")).toContainText("Preferences saved")
  await page.reload()
  await expect(page.getByLabel("Target title 2", { exact: true })).toHaveValue(
    "Platform Engineer"
  )
  await expect(page.getByLabel("Target title 2", { exact: true })).toBeVisible()
  await page
    .getByRole("button", { name: "More preferences · optional" })
    .click()
  await expect(page.getByLabel("Locations", { exact: true })).toHaveValue(
    "Chicago, Austin"
  )
  await page.screenshot({
    path: "output/playwright/target-preferences-mobile.png",
    fullPage: true,
  })
  await page.getByRole("button", { name: "Find jobs for me" }).click()
  await expect(page).toHaveURL(/\/dashboard\/discover$/)
  await expect(
    page.getByRole("heading", { name: "Discover", exact: true })
  ).toBeVisible()
  const completed = await state(page)
  expect(completed.targets).toHaveLength(2)
  expect(completed.completedAt).toBeTruthy()
  await page.goto("/onboarding")
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.reload()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect((await state(page)).completedAt).toBe(completed.completedAt)
  expect(await db.aiUsage.count({ where: { ownerUserId: owner } })).toBe(
    usageBefore
  )
  expect(await db.resumeVersion.count({ where: { ownerUserId: owner } })).toBe(
    3
  )
  console.log(
    JSON.stringify({
      proof: live ? "live" : "fixture",
      versions: 3,
      roles: 2,
      confirmedAt: confirmed.version.confirmedAt,
      completedAt: completed.completedAt,
      providerInvocationsAfterReviewStarted: 0,
      uploadId: completed.upload.id,
    })
  )
  return completed
}

test("@fixture durable resume review, stale tabs, mobile keyboard, route guards, no AI", async ({
  page,
  context,
}) => {
  const owner = await signup(page)
  await seededDraft(owner)
  await page.reload()
  await resumeAndPreferences(page, context, owner, false)
})

test("@fixture sidebar indicator persists across routes, history, refresh and responsive layouts", async ({
  page,
}) => {
  const owner = await signup(page)
  await seededDraft(owner)
  await page.reload()
  await page.getByRole("checkbox").check()
  await page
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click()
  await page
    .getByLabel("Target title 1", { exact: true })
    .fill("Backend Engineer")
  await page.getByRole("button", { name: "Find jobs for me" }).click()
  await expect(page).toHaveURL(/\/dashboard\/discover$/)

  const navigation = page.getByRole("navigation", { name: "Main navigation" })
  const indicator = navigation.locator('[data-slot="navigation-indicator"]')
  async function selected(label: string) {
    const link = navigation.getByRole("link", { name: label, exact: true })
    await expect(link).toHaveAttribute("aria-current", "page")
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(indicator).toHaveCount(1)
    await expect(indicator).toBeVisible()
    await expect
      .poll(async () => {
        const target = await link.boundingBox()
        const marker = await indicator.boundingBox()
        if (!target || !marker) return Infinity
        return Math.max(
          Math.abs(target.x - marker.x),
          Math.abs(target.y - marker.y),
          Math.abs(target.width - marker.width),
          Math.abs(target.height - marker.height)
        )
      })
      .toBeLessThan(1)
    expect(
      await indicator.evaluate((element) => getComputedStyle(element).opacity)
    ).toBe("1")
    expect(
      await indicator.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    ).not.toBe("rgba(0, 0, 0, 0)")
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await selected("Discover")
  await indicator.evaluate((element) =>
    element.setAttribute("data-proof", "persistent")
  )
  for (const label of ["Home", "Jobs", "Resume", "Discover"]) {
    await navigation.getByRole("link", { name: label, exact: true }).click()
    await selected(label)
    await expect(indicator).toHaveAttribute("data-proof", "persistent")
  }
  await page.goBack()
  await selected("Resume")
  await page.reload()
  await selected("Resume")

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(
    page.getByRole("link", { name: "Settings", exact: true })
  ).toHaveAttribute("aria-current", "page")
  await expect(indicator).toHaveCount(0)
  await navigation.getByRole("link", { name: "Home", exact: true }).click()
  await selected("Home")

  await page.setViewportSize({ width: 390, height: 844 })
  await selected("Home")
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await navigation.getByRole("link", { name: "Jobs", exact: true }).click()
  await selected("Jobs")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await navigation.getByRole("link", { name: "Resume", exact: true }).click()
  await selected("Resume")
  await page.setViewportSize({ width: 1280, height: 800 })
  await selected("Resume")
})

test("@live signup → upload → real AI draft → review → confirm → roles → dashboard; tenant isolation", async ({
  page,
  context,
  browser,
}) => {
  assert.equal(
    process.env.JOBSYNC_ONBOARDING_LIVE_BRANCH,
    `${project}/${branch}`,
    "explicit opt-in required for a live provider call"
  )
  const owner = await signup(page)
  await page.getByLabel("Resume file", { exact: true }).setInputFiles({
    name: "sanitized-onboarding.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: resumeDocx(),
  })
  await page.getByRole("button", { name: "Upload resume", exact: true }).click()
  await expect
    .poll(async () => (await state(page)).upload?.status)
    .toBe("uploaded")
  await page.reload()
  const completed = await resumeAndPreferences(page, context, owner, true)
  const second = await browser.newContext({
    baseURL: process.env.JOBSYNC_BROWSER_ORIGIN ?? "http://localhost:3000",
  })
  try {
    const other = await second.newPage()
    const otherOwner = await signup(other)
    await directRoutes(other, /\/onboarding$/)
    const isolated = await state(other)
    expect(isolated.version).toBeNull()
    expect(isolated.targets).toEqual([])
    for (const path of [
      `/api/resume-uploads/${completed.upload.id}`,
      `/api/resume-uploads/${completed.upload.id}/download-url`,
    ]) {
      const response = path.endsWith("download-url")
        ? await other.request.post(path)
        : await other.request.get(path)
      expect(response.status()).toBe(404)
    }
    for (const action of ["save", "confirm", "preferences"]) {
      const input =
        action === "save"
          ? {
              expectedVersionId: completed.version.id,
              data: completed.version.data,
            }
          : action === "confirm"
            ? { expectedVersionId: completed.version.id }
            : {
                expectedVersionId: completed.version.id,
                expectedRevision: 0,
                targets: completed.targets,
                complete: true,
              }
      expect(
        (
          await other.request.post("/api/onboarding", {
            data: { action, input },
          })
        ).status()
      ).toBe(404)
    }
    expect(
      await db.targetPreference.count({ where: { ownerUserId: otherOwner } })
    ).toBe(0)
    console.log(
      JSON.stringify({
        secondUserIsolation: true,
        privateUploadAndVersionAccess: "404",
        preferencesVisible: 0,
      })
    )
  } finally {
    await second.close()
  }
})
