import { test, expect, type Page } from "@playwright/test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { createDatabaseClient } from "../../lib/backend/create-db-client"
import {
  createStorageClient,
  STORAGE_BUCKET,
} from "../../lib/backend/create-storage-client"
import { createAccountDeletion } from "../../lib/domain/account/deletion"
import { accountCleanup } from "../../lib/domain/account/providers"
import { resumeDocx } from "../resume-structure-fixtures"

const db = createDatabaseClient(process.env.DATABASE_URL!)
const password = `Launch-proof-${randomUUID()}!`
const users: string[] = []
let baseline: { id: string; createdAt: Date }[] = []
let publicRows: { id: string; contentHash: string }[] = []
const origin = "https://jobsync-cloud.vercel.app"

async function signup(page: Page) {
  await page.goto("/auth/sign-up")
  const email = `launch-${randomUUID()}@example.com`
  await page.getByLabel("Name", { exact: true }).fill("Launch isolated proof")
  await page.getByLabel("Email address").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .click()
  await expect(page).toHaveURL(/\/auth\/verify$/)
  await expect(
    page.getByRole("heading", { name: "Verify your email" })
  ).toBeVisible()
  const session = await (await page.request.get("/api/auth/get-session")).json()
  assert.ok(session.user.id)
  users.push(session.user.id)
  // SMTP is an activation gate: this is an explicit admin-only test fixture,
  // scoped by BOTH newly-created session identity and unique fixture email.
  await db.$executeRaw`UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=${session.user.id} AND email=${email}`
  await page.goto("/onboarding")
  return session.user.id as string
}
async function privateCounts(owner: string) {
  return Promise.all([
    db.userProfile.count({ where: { id: owner } }),
    db.resume.count({ where: { ownerUserId: owner } }),
    db.resumeUpload.count({ where: { ownerUserId: owner } }),
    db.resumeVersion.count({ where: { ownerUserId: owner } }),
    db.targetPreference.count({ where: { ownerUserId: owner } }),
    db.application.count({ where: { ownerUserId: owner } }),
    db.jobMatch.count({ where: { ownerUserId: owner } }),
    db.companyWatch.count({ where: { ownerUserId: owner } }),
    db.processingRun.count({ where: { ownerUserId: owner } }),
    db.aiUsageReservation.count({ where: { ownerUserId: owner } }),
  ])
}
async function deleteInBrowser(page: Page) {
  await page.goto("/dashboard/settings?tab=data")
  await page
    .getByRole("button", { name: "Delete account…", exact: true })
    .click()
  const button = page.getByRole("button", {
    name: "Permanently delete account",
    exact: true,
  })
  await expect(button).toBeDisabled()
  await page.getByLabel("Type DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT")
  await page.getByLabel("Current password").fill(password)
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page).toHaveURL(/\/account-closed$/)
}

test.beforeAll(async () => {
  assert.equal(
    process.env.JOBSYNC_LAUNCH_PROOF,
    origin,
    "Explicit production proof opt-in required"
  )
  assert.ok(
    new URL(process.env.DATABASE_URL!).hostname.startsWith(
      "ep-green-scene-b45djevq"
    )
  )
  baseline = await db.userProfile.findMany({
    where: {id: {not: "7061368b-e0fa-4f80-beca-f6d0f920dbb1"}},
    select: { id: true, createdAt: true },
    orderBy: { id: "asc" },
  })
  publicRows = await db.jobPosting.findMany({
    select: { id: true, contentHash: true },
    orderBy: { id: "asc" },
  })
})
test.afterAll(async () => {
  const service = createAccountDeletion(db, accountCleanup())
  try {
    assert.ok(users.every((id) => !baseline.some((p) => p.id === id)))
    for (const owner of users) {
      if (await db.userProfile.findUnique({ where: { id: owner } }))
        await service.request(owner)
      await service.process(owner)
    }
    await expect
      .poll(async () => Promise.all(users.map(privateCounts)), {
        timeout: 900_000,
        intervals: [10_000],
      })
      .toEqual(users.map(() => Array(10).fill(0)))
    for (const owner of users) {
      expect(
        (
          await db.accountDeletionRequest.findUniqueOrThrow({
            where: { ownerUserId: owner },
          })
        ).status
      ).toBe("completed")
      const identities = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM neon_auth."user" WHERE id=${owner}`
      const sessions = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM neon_auth."session" WHERE "userId"=${owner}`
      expect(Number(identities[0].count)).toBe(0)
      expect(Number(sessions[0].count)).toBe(0)
    }
    const s3 = createStorageClient({
      endpoint: process.env.AWS_ENDPOINT_URL_S3!,
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    })
    try {
      for (const owner of users)
        expect(
          (
            await s3.send(
              new ListObjectsV2Command({
                Bucket: STORAGE_BUCKET,
                Prefix: `users/${owner}/`,
              })
            )
          ).KeyCount ?? 0
        ).toBe(0)
    } finally {
      s3.destroy()
    }
    expect(
      await db.userProfile.findMany({
        select: { id: true, createdAt: true },
        orderBy: { id: "asc" },
      })
    ).toEqual(baseline)
    const preserved = await db.jobPosting.count({
      where: { id: { in: publicRows.map((p) => p.id) } },
    })
    expect(preserved).toBe(publicRows.length)
    console.log(
      JSON.stringify({
        cleanup: "complete",
        temporaryUsers: users.length,
        privateRecords: 0,
        originalFiles: 0,
        founderPreserved: true,
        sharedPublicPostingsPreserved: true,
      })
    )
  } finally {
    await db.$disconnect()
  }
})

test("@launch production workflow, responsive themes, export, durable deletion and tenant isolation", async ({
  page,
  browser,
}) => {
  test.setTimeout(1_500_000)
  await page.goto("/")
  await expect(
    page.getByText("No Docker. No API keys. No configuration.", {
      exact: false,
    })
  ).toBeVisible()
  await page.screenshot({
    path: "output/playwright/launch-landing-desktop.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "output/playwright/launch-landing-mobile.png",
    fullPage: true,
  })
  await page.goto("/pricing")
  await expect(page.getByText("$6", { exact: false }).first()).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  const owner = await signup(page)
  const otherContext = await browser.newContext({ baseURL: origin })
  const other = await otherContext.newPage()
  const otherOwner = await signup(other)
  const otherApplication = await db.application.create({
    data: {
      ownerUserId: otherOwner,
      company: "Isolated tenant sentinel",
      creationKey: randomUUID(),
      sourceSnapshot: {},
      location: "Remote",
      title: "Independent private record",
      status: "saved",
    },
  })
  const otherSnapshot = await db.application.findUnique({
    where: { id: otherApplication.id },
  })
  await page.getByLabel("Resume file", { exact: true }).setInputFiles({
    name: "launch-synthetic.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: resumeDocx(),
  })
  await page.getByRole("button", { name: "Upload resume", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Review your resume", exact: true })
  ).toBeVisible({ timeout: 180_000 })
  await page.getByRole("checkbox").check()
  await page
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click()
  await page
    .getByLabel("Target title 1", { exact: true })
    .fill("Software Engineer")
  await page
    .getByLabel("Useful skills or keywords")
    .fill("TypeScript, PostgreSQL")
  await page.getByRole("button", { name: "Back to resume" }).click()
  await page.getByRole("button", { name: "Continue to target roles" }).click()
  await expect(page.getByLabel("Target title 1", { exact: true })).toHaveValue(
    "Software Engineer"
  )
  await page.getByRole("button", { name: "Finish onboarding" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(
    page.getByRole("heading", { name: "Keep things moving." })
  ).toBeVisible()
  await page
    .getByRole("link", { name: "Discover", exact: true })
    .first()
    .click()
  await page.getByLabel("Find a company").fill("Figma")
  await page.getByRole("button", { name: "Watch Figma", exact: true }).click()
  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: "Refresh", exact: true }).click()
        return page
          .getByRole("button", { name: "Track application", exact: true })
          .count()
      },
      { timeout: 360_000, intervals: [15_000] }
    )
    .toBeGreaterThan(0)
  await page
    .getByRole("button", { name: "Track application", exact: true })
    .first()
    .click()
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click()
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true })
  ).toBeVisible()
  expect(await db.application.count({ where: { ownerUserId: owner } })).toBe(1)
  await page.getByRole("link", { name: "Home", exact: true }).first().click()
  await expect(
    page.getByRole("heading", { name: "What to work on next" })
  ).toBeVisible()
  await page.getByRole("link", { name: "Resume", exact: true }).first().click()
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible()
  await page
    .getByRole("link", { name: "Settings", exact: true })
    .first()
    .click()
  await page.getByLabel("Display name").fill("Launch proof updated")
  await page.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Profile saved")
  await page.getByRole("tab", { name: "Plan & usage", exact: true }).click()
  await expect(
    page.getByText("Your 14-day trial", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Live charging is disabled.", { exact: false })
  ).toBeVisible()
  await page.screenshot({
    path: "output/playwright/launch-plan-desktop.png",
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  for (const route of [
    "/dashboard",
    "/dashboard/jobs",
    "/dashboard/discover",
    "/dashboard/resume",
    "/dashboard/settings",
  ]) {
    await page.goto(route)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      route
    ).toBe(true)
    await expect(
      page.getByRole("navigation", { name: "Main navigation" })
    ).toBeVisible()
  }
  await page.getByRole("button", { name: "Toggle color theme" }).first().click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.screenshot({
    path: "output/playwright/launch-settings-mobile-dark.png",
    fullPage: true,
  })
  await page.getByRole("tab", { name: "Your data", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByText("Export your workspace", { exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: "output/playwright/launch-settings-mobile.png",
    fullPage: true,
  })
  const exported = await page.request.get("/api/account/export")
  expect(exported.status()).toBe(200)
  expect(exported.headers()["cache-control"]).toContain("no-store")
  const data = await exported.json()
  expect(data.account.name).toBe("Launch proof updated")
  expect(data.applications).toHaveLength(1)
  expect(data.resumes[0].versions.length).toBeGreaterThan(0)
  expect(JSON.stringify(data)).not.toContain("Isolated tenant sentinel")
  const upload = await db.resumeUpload.findFirstOrThrow({
    where: { ownerUserId: owner },
  })
  const download = await page.request.post(
    `/api/resume-uploads/${upload.id}/download-url`
  )
  expect(download.status()).toBe(200)
  expect((await page.request.get((await download.json()).url)).status()).toBe(
    200
  )
  expect(
    (
      await other.request.post(`/api/resume-uploads/${upload.id}/download-url`)
    ).status()
  ).toBe(404)
  await deleteInBrowser(page)
  await expect
    .poll(
      async () =>
        (
          await db.accountDeletionRequest.findUnique({
            where: { ownerUserId: owner },
          })
        )?.status,
      { timeout: 900_000, intervals: [10_000] }
    )
    .toBe("completed")
  expect(await privateCounts(owner)).toEqual(Array(10).fill(0))
  expect(
    await db.application.findUnique({ where: { id: otherApplication.id } })
  ).toEqual(otherSnapshot)
  const authRows = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) AS count FROM neon_auth."user" WHERE id=${owner}`
  expect(Number(authRows[0].count)).toBe(0)
  await page.goto("/dashboard/settings")
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
  await deleteInBrowser(other)
  await otherContext.close()
  console.log(
    JSON.stringify({
      productionWalkthrough: true,
      realResumeAi: true,
      realDiscoverTracking: true,
      mobileOverflow: false,
      reducedMotion: true,
      keyboardTabs: true,
      exportAndOriginal: true,
      authRemoved: true,
      otherUserUnchanged: true,
    })
  )
})
