import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"
import {
  analyticsUrl,
  eventProperties,
  productEvents,
} from "../lib/analytics/events"
import { billingConfig } from "../lib/billing/config"
import { billingCheckoutAvailable } from "../lib/billing/entitlements"
import { createFeedbackService } from "../lib/domain/feedback/service"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { exportAccount } from "../lib/domain/account/export"
import { createSessionContext } from "../lib/auth/session-context"

const match = readFileSync(".env.billingtest", "utf8").match(
  /^BILLING_TEST_DATABASE_URL=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/m
)!
const url =
  process.env.BILLING_TEST_DATABASE_URL ?? match[1] ?? match[2] ?? match[3]
assert.ok(new URL(url).hostname.startsWith("ep-weathered-meadow-b46q35cx."))
const db = createDatabaseClient(url)
const owners = [randomUUID(), randomUUID()]
after(async () => {
  await db.userProfile.deleteMany({ where: { id: { in: owners } } })
  await db.$disconnect()
})

test("analytics allows only fixed paths and numeric durations, dropping private URL canaries", () => {
  const canary = "private-resume-email-notes-signed-link-canary"
  assert.equal(
    analyticsUrl(
      `https://jobsync-cloud.vercel.app/dashboard?email=${canary}#${canary}`
    ),
    "https://jobsync-cloud.vercel.app/dashboard"
  )
  assert.equal(
    analyticsUrl(`https://jobsync-cloud.vercel.app/dashboard/jobs/${canary}`),
    null
  )
  assert.equal(
    analyticsUrl(
      `https://jobsync-cloud.vercel.app/auth/reset-password?token=${canary}`
    ),
    null
  )
  assert.deepEqual(eventProperties(12.4), { elapsed_ms: 12 })
  for (const bad of [NaN, Infinity, -1, 86_400_001, canary])
    assert.equal(eventProperties(bad as number), undefined)
  assert.equal(
    productEvents.some((event) => event.includes(canary)),
    false
  )
})

test("live billing accepts restricted mode-matched keys, requires Portal, and isolates pre-rollout Checkout", () => {
  const saved = { ...process.env }
  try {
    Object.assign(process.env, {
      STRIPE_MODE: "live",
      STRIPE_SECRET_KEY: "rk_live_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      STRIPE_PLUS_PRICE_ID: "price_fixture",
      STRIPE_PLUS_PRODUCT_ID: "prod_fixture",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
      APP_ORIGIN: "https://jobsync-cloud.vercel.app",
      BILLING_ROLLOUT_READY: "false",
      BILLING_LIVE_PROOF_ALLOWED_USER_IDS: owners[0],
    })
    assert.equal(billingConfig().livemode, true)
    assert.equal(billingCheckoutAvailable(owners[0]), true)
    assert.equal(billingCheckoutAvailable(owners[1]), false)
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID
    assert.throws(billingConfig, /billing_not_configured/)
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_fixture"
    process.env.STRIPE_SECRET_KEY = "rk_test_fixture"
    assert.throws(billingConfig, /billing_mode_mismatch/)
    process.env.BILLING_LIVE_PROOF_ALLOWED_USER_IDS = "*"
    assert.equal(billingCheckoutAvailable("*"), false)
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
})

test("feedback is owner scoped, bounded under concurrency, idempotent, exported and deleted with its owner", async () => {
  for (const id of owners)
    await db.userProfile.create({ data: { id, displayName: "Release test" } })
  const service = createFeedbackService(db)
  const input = {
    category: "general",
    message: "Synthetic feedback chosen by tester",
    submissionKey: randomUUID(),
  }
  await Promise.all(
    Array.from({ length: 4 }, () => service.submit(owners[0], input))
  )
  assert.equal(
    await db.productFeedback.count({ where: { ownerUserId: owners[0] } }),
    1
  )
  await service.submit(owners[1], {
    ...input,
    message: "Other tenant private feedback",
  })
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      service.submit(owners[0], { ...input, submissionKey: randomUUID() })
    )
  )
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 4)
  assert.equal(
    await db.productFeedback.count({ where: { ownerUserId: owners[0] } }),
    5
  )
  await assert.rejects(
    () =>
      service.submit(owners[0], { ...input, resume: "must not be attached" }),
    { code: "invalid_input" }
  )
  const user = await createSessionContext(
    async () => ({
      data: {
        user: {
          id: owners[0],
          name: "Release test",
          email: "fixture@example.invalid",
          emailVerified: true,
        },
      },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
  const exported = await exportAccount(db, user)
  assert.equal(exported.feedback.length, 5)
  assert.equal(
    JSON.stringify(exported).includes("Other tenant private feedback"),
    false
  )
  await db.userProfile.update({
    where: { id: owners[1] },
    data: { deletionRequestedAt: new Date() },
  })
  await assert.rejects(() => service.submit(owners[1], input), {
    code: "account_deleting",
  })
  await db.userProfile.delete({ where: { id: owners[0] } })
  assert.equal(
    await db.productFeedback.count({ where: { ownerUserId: owners[0] } }),
    0
  )
  assert.equal(
    await db.productFeedback.count({ where: { ownerUserId: owners[1] } }),
    1
  )
})
