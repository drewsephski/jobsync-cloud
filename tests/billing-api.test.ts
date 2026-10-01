import assert from "node:assert/strict"
import { mock, test } from "node:test"
import Stripe from "stripe"
import { createSessionContext } from "../lib/auth/session-context"
const stripe = new Stripe("sk_test_fixture_signature")
const secret = "whsec_fixture_signature"
const user = await createSessionContext(
  async () => ({
    data: {
      user: {
        id: "billing-api-fixture",
        email: "billing@example.test",
        emailVerified: true,
      },
    },
    error: null,
  }),
  () => {
    throw new Error("redirect")
  }
).requireCurrentAuthUser()
let currentUser: typeof user | null = user
let ready = true,
  unavailable = false,
  calls = 0,
  provisions = 0
mock.module(new URL("../lib/db.ts", import.meta.url).href, {
  namedExports: { db: {} },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "https://jobsync.example" } },
})
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => currentUser },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async () => {
      provisions++
    },
  },
})
mock.module(new URL("../lib/billing/entitlements.ts", import.meta.url).href, {
  namedExports: { billingCheckoutAvailable: () => ready },
})
mock.module(new URL("../lib/billing/config.ts", import.meta.url).href, {
  namedExports: {
    billingConfig: () => ({ STRIPE_WEBHOOK_SECRET: secret, livemode: false }),
  },
})
mock.module(new URL("../lib/billing/stripe.ts", import.meta.url).href, {
  namedExports: { stripeClient: () => stripe },
})
mock.module(new URL("../lib/billing/service.ts", import.meta.url).href, {
  namedExports: {
    createBillingService: () => ({
      webhook: async () => {
        calls++
        if (unavailable) throw new Error("provider-secret-must-not-leak")
        return { received: true }
      },
      checkout: async (identity: typeof user) => {
        calls++
        assert.equal(identity.id, user.id)
        return "https://checkout.stripe.com/fixture"
      },
      portal: async (identity: typeof user) => {
        calls++
        assert.equal(identity.id, user.id)
        return "https://billing.stripe.com/fixture"
      },
    }),
  },
})
const { POST: webhook } = await import("../app/api/billing/webhook/route")
const { billingAction } = await import("../lib/billing/api")
function event(livemode = false) {
  return JSON.stringify({
    id: "evt_signature_fixture",
    type: "invoice.paid",
    created: Math.floor(Date.now() / 1000),
    livemode,
    data: { object: { customer: "cus_fixture" } },
  })
}
function request(body: string, signature?: string) {
  return new Request("https://jobsync.example/api/billing/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  })
}
test("only a verified raw-body Stripe signature reaches reconciliation", async () => {
  const before = calls,
    body = event()
  assert.equal((await webhook(request(body))).status, 400)
  assert.equal((await webhook(request(body, "invalid"))).status, 400)
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  })
  assert.equal((await webhook(request(body + " ", signature))).status, 400)
  const stale = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp: Math.floor(Date.now() / 1000) - 1000,
  })
  assert.equal((await webhook(request(body, stale))).status, 400)
  assert.equal(calls, before)
  assert.equal((await webhook(request(body, signature))).status, 200)
  assert.equal(calls, before + 1)
})
test("signed wrong-mode and bounded oversized payloads cannot grant access; failures remain retryable", async () => {
  const before = calls,
    body = event(true)
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  })
  assert.equal((await webhook(request(body, signature))).status, 400)
  assert.equal(
    (await webhook(request("x".repeat(1_000_001), signature))).status,
    413
  )
  assert.equal(calls, before)
  unavailable = true
  const good = event()
  const signed = stripe.webhooks.generateTestHeaderString({
    payload: good,
    secret,
  })
  const response = await webhook(request(good, signed))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "billing_unavailable" })
  unavailable = false
})
test("billing mutations require exact origin, server session, and ready rollout; portal remains available during setup", async () => {
  const before = calls,
    beforeProvision = provisions
  for (const origin of [undefined, "https://evil.example"]) {
    const req = new Request("https://jobsync.example/api/billing/checkout", {
      method: "POST",
      headers: origin ? { origin } : {},
    })
    assert.equal((await billingAction(req, "checkout")).status, 403)
  }
  assert.equal(calls, before)
  assert.equal(provisions, beforeProvision)
  const req = () =>
    new Request("https://jobsync.example/api/billing/checkout", {
      method: "POST",
      headers: { origin: "https://jobsync.example" },
    })
  currentUser = null
  assert.equal((await billingAction(req(), "checkout")).status, 401)
  currentUser = user
  ready = false
  assert.equal((await billingAction(req(), "checkout")).status, 503)
  assert.equal((await billingAction(req(), "portal")).status, 200)
  ready = true
  assert.equal((await billingAction(req(), "checkout")).status, 200)
})
