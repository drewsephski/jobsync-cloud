import { readFile, writeFile } from "node:fs/promises"
import nextEnv from "@next/env"
import Stripe from "stripe"
nextEnv.loadEnvConfig(process.cwd())
const key = process.env.STRIPE_SECRET_KEY
if (!key?.startsWith("sk_test_"))
  throw new Error(
    "Test-mode key required; this script never configures live billing"
  )
const stripe = new Stripe(key, { maxNetworkRetries: 2 })
const account = await stripe.accounts.retrieve("acct_1ULiCSDkevFaCoHn")
if (account.id !== "acct_1ULiCSDkevFaCoHn")
  throw new Error("Unexpected Stripe test account; review before configuring")
const origin = process.env.APP_ORIGIN
if (!origin || new URL(origin).origin !== origin)
  throw new Error("Exact APP_ORIGIN required")
const product = await stripe.products.create(
  {
    name: "JobSync Plus",
    description:
      "JobSync Cloud application tracking, confirmed resumes, recurring discovery and bounded included AI.",
    metadata: { jobsync_app: "cloud", plan: "plus" },
  },
  { idempotencyKey: "jobsync-plus-product-v1" }
)
const price = await stripe.prices.create(
  {
    product: product.id,
    currency: "usd",
    unit_amount: 600,
    recurring: { interval: "month" },
    lookup_key: "jobsync_plus_monthly_v1",
    metadata: { jobsync_app: "cloud" },
  },
  { idempotencyKey: "jobsync-plus-price-6usd-month-v1" }
)
const portal = await stripe.billingPortal.configurations.create(
  {
    business_profile: { headline: "Manage your JobSync Plus subscription" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: { enabled: false },
    },
    metadata: { jobsync_app: "cloud" },
  },
  { idempotencyKey: "jobsync-portal-config-v1" }
)
const endpoint = await stripe.webhookEndpoints.create(
  {
    url: `${origin}/api/billing/webhook`,
    description: "JobSync Cloud test-mode subscription reconciliation",
    enabled_events: [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.payment_action_required",
      "invoice.finalization_failed",
      "invoice.voided",
      "invoice.marked_uncollectible",
    ],
    metadata: { jobsync_app: "cloud" },
  },
  { idempotencyKey: "jobsync-test-webhook-v1" }
)
if (!endpoint.secret || product.livemode || price.livemode || endpoint.livemode)
  throw new Error("Test setup failed")
const vars = {
  STRIPE_MODE: "test",
  STRIPE_PLUS_PRODUCT_ID: product.id,
  STRIPE_PLUS_PRICE_ID: price.id,
  STRIPE_PORTAL_CONFIGURATION_ID: portal.id,
  STRIPE_WEBHOOK_SECRET: endpoint.secret,
  BILLING_ROLLOUT_READY: "false",
}
let env = await readFile(".env.local", "utf8")
for (const [name, value] of Object.entries(vars)) {
  const pattern = new RegExp(`^${name}=.*$`, "m")
  const line = `${name}=${value}`
  env = pattern.test(env) ? env.replace(pattern, line) : env + `\n${line}\n`
}
await writeFile(".env.local", env, { mode: 0o600 })
console.log(
  JSON.stringify({
    accountId: account.id,
    mode: "test",
    productId: product.id,
    priceId: price.id,
    portalConfigurationId: portal.id,
    webhookEndpointId: endpoint.id,
    webhookUrl: endpoint.url,
    secretStoredInIgnoredLocalEnv: true,
  })
)
