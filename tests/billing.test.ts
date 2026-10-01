import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import type Stripe from "stripe"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createBillingService } from "../lib/billing/service"
import {
  createAiAccounting,
  AllowanceError,
} from "../lib/domain/resume-structure/accounting"
import { createDiscoveryWorker } from "../lib/domain/discovery/worker"
import { createDiscoveryService } from "../lib/domain/discovery/service"
import { MATCH_AI_CONFIG } from "../lib/ai/config"
import type { CurrentAuthUser } from "../lib/auth/session-context"
import {
  readEntitlement,
  resolveEntitlement,
} from "../lib/billing/entitlements"
import type { billingConfig } from "../lib/billing/config"

nextEnv.loadEnvConfig(process.cwd())
const billingTestEnv = readFileSync(
  new URL("../.env.billingtest", import.meta.url),
  "utf8"
)
const billingTestDatabaseMatch = billingTestEnv.match(
  /^BILLING_TEST_DATABASE_URL=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/m
)
assert.ok(
  billingTestDatabaseMatch,
  "isolated billing test URL must be configured"
)
const billingTestDatabaseUrl =
  process.env.BILLING_TEST_DATABASE_URL ??
  billingTestDatabaseMatch[1] ??
  billingTestDatabaseMatch[2] ??
  billingTestDatabaseMatch[3]
assert.ok(billingTestDatabaseUrl)
const billingTestDatabaseHost = new URL(billingTestDatabaseUrl).hostname
assert.ok(billingTestDatabaseHost.startsWith("ep-weathered-meadow-b46q35cx."))
assert.ok(!billingTestDatabaseHost.startsWith("ep-green-scene-b45djevq"))

// Keep entitlement reads aligned with the isolated test-mode customer fixtures.
process.env.STRIPE_MODE = "test"
const db = createDatabaseClient(billingTestDatabaseUrl)
after(() => db.$disconnect())
await Promise.all(
  [
    {
      id: "resume",
      enabled: true,
      ownerMonthlyUnits: BigInt(65),
      ownerMonthlyCostMicroUsd: BigInt(1_500_000),
      globalDailyCostMicroUsd: BigInt(5_000_000),
    },
    {
      id: "discovery",
      enabled: true,
      ownerMonthlyUnits: BigInt(100),
      ownerMonthlyCostMicroUsd: BigInt(1_500_000),
      globalDailyCostMicroUsd: BigInt(5_000_000),
    },
  ].map((policy) =>
    db.aiBudgetPolicy.upsert({
      where: { id: policy.id },
      create: policy,
      update: policy,
    })
  )
)

const config: ReturnType<typeof billingConfig> = {
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_billing_tests",
  STRIPE_WEBHOOK_SECRET: "whsec_billing_tests",
  STRIPE_PLUS_PRICE_ID: "price_billing_tests_plus_monthly",
  STRIPE_PLUS_PRODUCT_ID: "prod_billing_tests_plus",
  STRIPE_PORTAL_CONFIGURATION_ID: undefined,
  APP_ORIGIN: "https://jobsync.example",
  livemode: false,
}

type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused"

type RemoteSubscription = {
  id: string
  customer: string
  livemode: boolean
  status: SubscriptionStatus
  created: number
  cancel_at_period_end: boolean
  cancelAt?: number | null
  current_period_start: number
  current_period_end: number
  priceId?: string
  productId?: string
  amount?: number
  currency?: string
  interval?: string
  intervalCount?: number
  noItems?: boolean
  trialEnd?: number
  latestInvoiceStatus?: "paid" | "open" | "uncollectible" | null
}

const fromUnix = (timestamp: number) => new Date(timestamp * 1000)

function remoteSubscription(
  customer: string,
  overrides: Partial<RemoteSubscription> = {}
): RemoteSubscription {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `sub_${randomUUID()}`,
    customer,
    livemode: false,
    status: "active",
    created: now - 3600,
    cancel_at_period_end: false,
    cancelAt: null,
    trialEnd: undefined,
    current_period_start: now - 3600,
    current_period_end: now + 28 * 24 * 60 * 60,
    latestInvoiceStatus: "paid",
    ...overrides,
  }
}

function subscriptionForStripe(value: RemoteSubscription) {
  return {
    id: value.id,
    customer: value.customer,
    livemode: value.livemode,
    status: value.status,
    created: value.created,
    cancel_at_period_end: value.cancel_at_period_end,
    cancel_at: value.cancelAt ?? null,
    trial_end: value.trialEnd,
    latest_invoice:
      value.latestInvoiceStatus === null
        ? null
        : {
            id: `in_${value.id}`,
            status: value.latestInvoiceStatus,
          },
    items: {
      data: value.noItems
        ? []
        : [
            {
              quantity: 1,
              current_period_start: value.current_period_start,
              current_period_end: value.current_period_end,
              price: {
                id: value.priceId ?? config.STRIPE_PLUS_PRICE_ID,
                product: value.productId ?? config.STRIPE_PLUS_PRODUCT_ID,
                unit_amount: value.amount ?? 600,
                currency: value.currency ?? "usd",
                recurring: {
                  interval: value.interval ?? "month",
                  interval_count: value.intervalCount ?? 1,
                },
              },
            },
          ],
    },
  }
}

function fakeStripe(options: { initialCustomerId?: string } = {}) {
  const subscriptionState = new Map<
    string,
    ReturnType<typeof subscriptionForStripe>[]
  >()
  const customers = new Map<
    string,
    {
      id: string
      livemode: boolean
      deleted: false
      metadata: Record<string, string>
    }
  >()
  if (options.initialCustomerId) {
    customers.set(options.initialCustomerId, {
      id: options.initialCustomerId,
      livemode: false,
      deleted: false,
      metadata: { jobsync_app: "cloud" },
    })
  }
  let customerCreateCalls = 0
  let checkoutCreateCalls = 0
  let failSubscriptionReads = false
  const sessions = new Map<
    string,
    {
      id: string
      url: string
      status: "open" | "complete" | "expired"
      expires_at: number
      livemode: boolean
    }
  >()

  const adapter = {
    prices: {
      retrieve: async () => ({
        id: config.STRIPE_PLUS_PRICE_ID,
        active: true,
        livemode: false,
        product: config.STRIPE_PLUS_PRODUCT_ID,
        unit_amount: 600,
        currency: "usd",
        recurring: { interval: "month", interval_count: 1 },
        type: "recurring",
      }),
    },
    customers: {
      search: async ({ query }: { query: string }) => {
        const billingId = query.match(/:'([^']+)'$/)?.[1]
        return {
          data: Array.from(customers.values()).filter(
            (customer) => customer.metadata.jobsync_billing_id === billingId
          ),
          has_more: false,
        }
      },
      create: async (params: { metadata?: Record<string, string> }) => {
        customerCreateCalls++
        const id = `cus_${randomUUID()}`
        const customer = {
          id,
          livemode: false,
          deleted: false as const,
          metadata: params.metadata ?? {},
        }
        customers.set(id, customer)
        return customer
      },
      retrieve: async (id: string) =>
        customers.get(id) ?? {
          id,
          livemode: false,
          deleted: false as const,
          metadata: {},
        },
    },
    subscriptions: {
      list: async ({ customer }: { customer: string }) => {
        if (failSubscriptionReads) throw new Error("stripe_unavailable")
        return { data: subscriptionState.get(customer) ?? [], has_more: false }
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          checkoutCreateCalls++
          const id = `cs_${randomUUID()}`
          const session = {
            id,
            url: `https://checkout.stripe.example/${id}`,
            status: "open" as const,
            expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
            livemode: false,
          }
          sessions.set(id, session)
          return session
        },
        retrieve: async (id: string) => sessions.get(id)!,
      },
    },
  }
  return {
    adapter: adapter as unknown as Stripe,
    subscriptions: subscriptionState,
    failSubscriptionReads: () => {
      failSubscriptionReads = true
    },
    seedCustomerForBillingId: (billingId: string, ownerUserId: string) => {
      const id = `cus_recovered_${randomUUID()}`
      customers.set(id, {
        id,
        livemode: false,
        deleted: false,
        metadata: {
          jobsync_app: "cloud",
          jobsync_billing_id: billingId,
          jobsync_owner: ownerUserId,
        },
      })
      return id
    },
    counters: () => ({ customerCreateCalls, checkoutCreateCalls }),
  }
}

async function withBillingTestAllowed<T>(
  ownerUserId: string,
  work: () => Promise<T>
) {
  const variable = "BILLING_TEST_ALLOWED_USER_IDS"
  const previous = process.env[variable]
  const allowed = new Set(
    (previous ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  )
  allowed.add(ownerUserId)
  process.env[variable] = [...allowed].join(",")
  try {
    return await work()
  } finally {
    if (previous === undefined) delete process.env[variable]
    else process.env[variable] = previous
  }
}

async function fixture(
  work: (f: {
    owner: string
    customerId: string
    service: ReturnType<typeof createBillingService>
    stripe: ReturnType<typeof fakeStripe>
  }) => Promise<void>,
  options: { withCustomer?: boolean } = {}
) {
  const owner = `billing-test-${randomUUID()}`
  const customerId = `cus_billing_${randomUUID()}`
  await db.userProfile.create({
    data: {
      id: owner,
      emailVerifiedAt: new Date(),
      trialStartedAt: new Date(Date.now() - 60_000),
      trialEndsAt: new Date(Date.now() + 60_000),
    },
  })
  let customer: { id: string } | null = null
  if (options.withCustomer !== false) {
    customer = await db.billingCustomer.create({
      data: {
        ownerUserId: owner,
        livemode: false,
        stripeCustomerId: customerId,
      },
    })
  }
  const stripe = fakeStripe(
    options.withCustomer === false ? {} : { initialCustomerId: customerId }
  )
  const service = createBillingService(db, stripe.adapter, config)
  try {
    await work({ owner, customerId, service, stripe })
  } finally {
    await db.aiUsage.deleteMany({ where: { ownerUserId: owner } })
    await db.aiUsageReservation.deleteMany({ where: { ownerUserId: owner } })
    await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
    customer ??= await db.billingCustomer.findUnique({
      where: { ownerUserId_livemode: { ownerUserId: owner, livemode: false } },
      select: { id: true },
    })
    if (customer) {
      await db.billingWebhookEvent.deleteMany({
        where: { customerId: customer.id },
      })
      await db.billingSubscription.deleteMany({
        where: { customerId: customer.id },
      })
      await db.billingCustomer.delete({ where: { id: customer.id } })
    }
    await db.discoveryAllowance.deleteMany({ where: { ownerUserId: owner } })
    await db.userProfile.delete({ where: { id: owner } })
  }
}

async function liveRuns(ownerUserId: string, label: string, count: number) {
  return db.processingRun.createManyAndReturn({
    data: Array.from({ length: count }, () => ({
      ownerUserId,
      kind: `billing-cap-${label}`,
      resourceId: randomUUID(),
      idempotencyKey: `billing-test:${label}:${randomUUID()}`,
      status: "running",
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 120_000),
      startedAt: new Date(),
    })),
  })
}

async function expectConcurrentCap(
  accounting: ReturnType<typeof createAiAccounting>,
  runs: Awaited<ReturnType<typeof liveRuns>>,
  allowed: number
) {
  const results: PromiseSettledResult<
    Awaited<ReturnType<typeof accounting.reserve>>
  >[] = []
  for (let start = 0; start < runs.length; start += 8) {
    results.push(
      ...(await Promise.allSettled(
        runs.slice(start, start + 8).map((run) => accounting.reserve(run))
      ))
    )
  }
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    allowed
  )
  for (const result of results) {
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof AllowanceError)
      assert.equal(result.reason.code, "allowance_exhausted")
    }
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  )
}

async function addPlusSubscription(ownerUserId: string, customerId: string) {
  const customer = await db.billingCustomer.findUniqueOrThrow({
    where: { stripeCustomerId: customerId },
  })
  const start = new Date(Date.now() - 60_000)
  await db.billingSubscription.create({
    data: {
      stripeSubscriptionId: `sub_local_plus_${randomUUID()}`,
      customerId: customer.id,
      stripePriceId: config.STRIPE_PLUS_PRICE_ID,
      status: "active",
      eligible: true,
      currentPeriodStart: start,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      cancelAtPeriodEnd: false,
      stripeCreatedAt: start,
      lastEventId: `evt_local_plus_${randomUUID()}`,
      reconciledAt: new Date(),
    },
  })
  assert.equal((await readEntitlement(db, ownerUserId)).plan, "plus")
}

function event(customer: string, id: string, created: number) {
  return {
    id,
    livemode: false,
    created,
    type: "customer.subscription.updated",
    data: { object: { id: `sub_event_${id}`, customer } },
  } as unknown as Stripe.Event
}

test("canonical webhook reconciliation grants only the configured paid plan and ignores duplicate deliveries", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const paid = remoteSubscription(customerId)
    stripe.subscriptions.set(customerId, [subscriptionForStripe(paid)])
    const delivered = event(
      customerId,
      `evt_paid_${randomUUID()}`,
      paid.created
    )

    const deliveries = await Promise.all(
      Array.from({ length: 8 }, () => service.webhook(delivered))
    )
    assert.equal(deliveries.filter((result) => "received" in result).length, 1)
    assert.equal(deliveries.filter((result) => "duplicate" in result).length, 7)
    assert.equal(
      await db.billingWebhookEvent.count({ where: { id: delivered.id } }),
      1
    )
    const stored = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: paid.id },
    })
    assert.equal(stored.eligible, true)
    assert.equal(stored.status, "active")
    assert.equal(stored.stripePriceId, config.STRIPE_PLUS_PRICE_ID)
    assert.deepEqual(await readEntitlement(db, owner), {
      plan: "plus",
      verified: true,
      periodStart: fromUnix(paid.current_period_start),
      periodEnd: fromUnix(paid.current_period_end),
      cancelAtPeriodEnd: false,
      subscriptionStatus: "active",
      limits: {
        resumeRuns: 5,
        jobAnalyses: 60,
        watches: 30,
        dailyScans: 2,
        costMicroUsd: BigInt(1_500_000),
      },
    })
    stripe.failSubscriptionReads()
    await assert.rejects(
      service.webhook(
        event(
          customerId,
          `evt_stripe_unavailable_${randomUUID()}`,
          paid.created
        )
      ),
      /stripe_unavailable/
    )
    assert.equal((await readEntitlement(db, owner)).plan, "plus")
  }))

test("out-of-order events reconcile canonical cancellation, delinquency, renewal and resubscribe state", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const original = remoteSubscription(customerId)
    stripe.subscriptions.set(customerId, [subscriptionForStripe(original)])
    await service.webhook(
      event(customerId, `evt_active_${randomUUID()}`, original.created)
    )

    // An old event observes the current canceled snapshot and removes paid access.
    const canceled = { ...original, status: "canceled" as const }
    stripe.subscriptions.set(customerId, [subscriptionForStripe(canceled)])
    await service.webhook(
      event(
        customerId,
        `evt_old_cancel_${randomUUID()}`,
        original.created - 100
      )
    )
    assert.equal(
      (
        await db.billingSubscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: original.id },
        })
      ).eligible,
      false
    )
    assert.equal((await readEntitlement(db, owner)).plan, "trial")

    // A later paid snapshot renews the same subscription and advances its period.
    const renewed = {
      ...original,
      current_period_start: Math.floor(Date.now() / 1000) - 60,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      cancel_at_period_end: true,
    }
    stripe.subscriptions.set(customerId, [subscriptionForStripe(renewed)])
    await service.webhook(
      event(customerId, `evt_renewed_${randomUUID()}`, original.created + 1)
    )
    const renewedRow = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: original.id },
    })
    assert.equal(renewedRow.eligible, true)
    assert.equal(renewedRow.cancelAtPeriodEnd, true)
    assert.equal(
      renewedRow.currentPeriodStart.getTime(),
      fromUnix(renewed.current_period_start).getTime()
    )
    assert.equal((await readEntitlement(db, owner)).plan, "plus")

    // A subsequent failure updates status from the provider snapshot, even if its delivery is older.
    const delinquent = {
      ...renewed,
      status: "past_due" as const,
      cancel_at_period_end: false,
    }
    stripe.subscriptions.set(customerId, [subscriptionForStripe(delinquent)])
    await service.webhook(
      event(
        customerId,
        `evt_late_payment_failure_${randomUUID()}`,
        original.created - 200
      )
    )
    assert.equal(
      (
        await db.billingSubscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: original.id },
        })
      ).eligible,
      false
    )
    assert.equal((await readEntitlement(db, owner)).plan, "trial")

    // Canceled old subscription plus a new valid one restores access via resubscription.
    const replacement = remoteSubscription(customerId, {
      created: original.created + 100,
    })
    stripe.subscriptions.set(customerId, [
      subscriptionForStripe(canceled),
      subscriptionForStripe(replacement),
    ])
    await service.webhook(
      event(customerId, `evt_resubscribe_${randomUUID()}`, replacement.created)
    )
    assert.equal(
      (
        await db.billingSubscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: original.id },
        })
      ).eligible,
      false
    )
    assert.equal(
      (
        await db.billingSubscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: replacement.id },
        })
      ).eligible,
      true
    )
    assert.equal((await readEntitlement(db, owner)).plan, "plus")
  }))

test("modern scheduled cancellation ends Plus at cancel_at and canonical resume clears it", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const subscription = remoteSubscription(customerId)
    const cancelAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const scheduled = {
      ...subscription,
      cancel_at_period_end: false,
      cancelAt,
    }
    stripe.subscriptions.set(customerId, [subscriptionForStripe(scheduled)])
    await service.webhook(
      event(customerId, `evt_cancel_at_${randomUUID()}`, scheduled.created)
    )

    const canceledSoon = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subscription.id },
    })
    assert.equal(canceledSoon.eligible, true)
    assert.equal(canceledSoon.cancelAtPeriodEnd, true)
    assert.equal(
      canceledSoon.currentPeriodEnd.getTime(),
      fromUnix(cancelAt).getTime()
    )
    assert.equal((await readEntitlement(db, owner)).plan, "plus")
    assert.equal(
      (
        await readEntitlement(
          db,
          owner,
          new Date(fromUnix(cancelAt).getTime() + 1000)
        )
      ).plan,
      "expired"
    )

    const resumed = {
      ...subscription,
      cancel_at_period_end: false,
      cancelAt: null,
    }
    stripe.subscriptions.set(customerId, [subscriptionForStripe(resumed)])
    await service.webhook(
      event(customerId, `evt_cancel_cleared_${randomUUID()}`, resumed.created)
    )
    const active = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subscription.id },
    })
    assert.equal(active.cancelAtPeriodEnd, false)
    assert.equal(
      active.currentPeriodEnd.getTime(),
      fromUnix(subscription.current_period_end).getTime()
    )
    assert.equal((await readEntitlement(db, owner)).plan, "plus")
  }))

test("canonical but wrong-price or unpaid subscriptions remain stored and never grant Plus", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const wrongPrice = remoteSubscription(customerId, {
      priceId: "price_wrong",
      productId: "prod_wrong",
    })
    stripe.subscriptions.set(customerId, [subscriptionForStripe(wrongPrice)])
    await service.webhook(
      event(customerId, `evt_wrong_price_${randomUUID()}`, wrongPrice.created)
    )
    const wrongRow = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: wrongPrice.id },
    })
    assert.equal(wrongRow.eligible, false)
    assert.equal(wrongRow.stripePriceId, "price_wrong")

    const unpaid = remoteSubscription(customerId, {
      latestInvoiceStatus: "open",
    })
    stripe.subscriptions.set(customerId, [subscriptionForStripe(unpaid)])
    await service.webhook(
      event(customerId, `evt_unpaid_${randomUUID()}`, unpaid.created)
    )
    assert.equal(
      (
        await db.billingSubscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: unpaid.id },
        })
      ).eligible,
      false
    )
    assert.equal((await readEntitlement(db, owner)).plan, "trial")
  }))

test("trialing subscription with no item is safely reconciled without Plus eligibility", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const malformedTrial = remoteSubscription(customerId, {
      status: "trialing",
      noItems: true,
      trialEnd: Math.floor(Date.now() / 1000) + 3600,
    })
    stripe.subscriptions.set(customerId, [
      subscriptionForStripe(malformedTrial),
    ])
    await service.webhook(
      event(
        customerId,
        `evt_empty_trial_${randomUUID()}`,
        malformedTrial.created
      )
    )
    const stored = await db.billingSubscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: malformedTrial.id },
    })
    assert.equal(stored.status, "trialing")
    assert.equal(stored.stripePriceId, "unknown")
    assert.equal(stored.eligible, false)
    assert.equal((await readEntitlement(db, owner)).plan, "trial")
  }))

test("webhook mode and customer boundaries prevent cross-customer reconciliation", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const existing = remoteSubscription(customerId)
    stripe.subscriptions.set(customerId, [subscriptionForStripe(existing)])
    await assert.rejects(
      service.webhook({
        ...event(
          customerId,
          `evt_wrong_mode_${randomUUID()}`,
          existing.created
        ),
        livemode: true,
      }),
      /billing_mode_mismatch/
    )

    const wrongModeSubscription = remoteSubscription(customerId, {
      livemode: true,
    })
    stripe.subscriptions.set(customerId, [
      subscriptionForStripe(wrongModeSubscription),
    ])
    const wrongSubscriptionModeEventId = `evt_wrong_subscription_mode_${randomUUID()}`
    await assert.rejects(
      service.webhook(
        event(customerId, wrongSubscriptionModeEventId, existing.created)
      ),
      /subscription_mode_mismatch/
    )
    assert.equal(
      await db.billingWebhookEvent.count({
        where: { id: wrongSubscriptionModeEventId },
      }),
      0
    )

    const foreignCustomerId = `cus_foreign_${randomUUID()}`
    await assert.deepEqual(
      await service.webhook(
        event(
          foreignCustomerId,
          `evt_foreign_${randomUUID()}`,
          existing.created
        )
      ),
      { ignored: true }
    )
    const mappedCustomer = await db.billingCustomer.findUniqueOrThrow({
      where: { stripeCustomerId: customerId },
    })
    assert.equal(
      await db.billingSubscription.count({
        where: { customerId: mappedCustomer.id },
      }),
      0
    )
    assert.equal((await readEntitlement(db, owner)).plan, "trial")
  }))

test("concurrent first checkouts create one customer and reuse one open Checkout session", async () =>
  fixture(
    async ({ owner, service, stripe }) => {
      const user = {
        id: owner,
        name: "Billing test",
        email: `${owner}@example.test`,
        emailVerified: true,
      } as CurrentAuthUser
      const unauthorized = {
        ...user,
        id: `unauthorized_${randomUUID()}`,
      } as CurrentAuthUser
      await assert.rejects(
        service.checkout(unauthorized),
        /test_billing_restricted/
      )
      const urls = await withBillingTestAllowed(owner, () =>
        Promise.all(Array.from({ length: 8 }, () => service.checkout(user)))
      )
      assert.equal(new Set(urls).size, 1)
      assert.deepEqual(stripe.counters(), {
        customerCreateCalls: 1,
        checkoutCreateCalls: 1,
      })
      const customer = await db.billingCustomer.findUniqueOrThrow({
        where: {
          ownerUserId_livemode: { ownerUserId: owner, livemode: false },
        },
      })
      assert.equal(customer.checkoutAttempt, 1)
      assert.equal(customer.checkoutUrl, urls[0])
      assert.equal(customer.stripeCustomerId?.startsWith("cus_"), true)
    },
    { withCustomer: false }
  ))

test("failed async Checkout payment expires the session so a retry can create a fresh one", async () =>
  fixture(async ({ owner, customerId, service, stripe }) => {
    const user = {
      id: owner,
      name: "Billing test",
      email: `${owner}@example.test`,
      emailVerified: true,
    } as CurrentAuthUser
    await withBillingTestAllowed(owner, async () => {
      const firstUrl = await service.checkout(user)
      const customer = await db.billingCustomer.findUniqueOrThrow({
        where: {
          ownerUserId_livemode: { ownerUserId: owner, livemode: false },
        },
      })
      const failedEvent = {
        ...event(
          customerId,
          `evt_async_payment_failed_${randomUUID()}`,
          Math.floor(Date.now() / 1000)
        ),
        type: "checkout.session.async_payment_failed",
        data: {
          object: {
            id: customer.checkoutSessionId!,
            customer: customerId,
          },
        },
      } as unknown as Stripe.Event
      assert.deepEqual(await service.webhook(failedEvent), { received: true })
      const failedCustomer = await db.billingCustomer.findUniqueOrThrow({
        where: { id: customer.id },
      })
      assert.ok(failedCustomer.checkoutExpiresAt)
      assert.ok(failedCustomer.checkoutExpiresAt.getTime() <= Date.now())

      const retryUrl = await service.checkout(user)
      assert.notEqual(retryUrl, firstUrl)
      assert.equal(stripe.counters().checkoutCreateCalls, 2)
      const retriedCustomer = await db.billingCustomer.findUniqueOrThrow({
        where: { id: customer.id },
      })
      assert.equal(retriedCustomer.checkoutAttempt, 2)
      assert.ok(retriedCustomer.checkoutExpiresAt!.getTime() > Date.now())
      assert.deepEqual(await service.webhook(failedEvent), { duplicate: true })
      assert.ok(
        (
          await db.billingCustomer.findUniqueOrThrow({
            where: { id: customer.id },
          })
        ).checkoutExpiresAt!.getTime() > Date.now()
      )
    })
  }))

test("checkout recovers a remote customer by durable billing metadata", async () =>
  fixture(
    async ({ owner, service, stripe }) => {
      const placeholder = await db.billingCustomer.create({
        data: { ownerUserId: owner, livemode: false },
      })
      const recoveredCustomerId = stripe.seedCustomerForBillingId(
        placeholder.id,
        owner
      )
      const user = {
        id: owner,
        name: "Billing test",
        email: `${owner}@example.test`,
        emailVerified: true,
      } as CurrentAuthUser
      await withBillingTestAllowed(owner, async () => {
        const url = await service.checkout(user)
        assert.ok(url.startsWith("https://checkout.stripe.example/"))
      })
      const customer = await db.billingCustomer.findUniqueOrThrow({
        where: { id: placeholder.id },
      })
      assert.equal(customer.stripeCustomerId, recoveredCustomerId)
      assert.equal(stripe.counters().customerCreateCalls, 0)
      assert.equal(stripe.counters().checkoutCreateCalls, 1)
    },
    { withCustomer: false }
  ))

test("live AI reservations enforce verified trial and Plus unit caps across a plan change", async () =>
  fixture(async ({ owner, customerId }) => {
    await db.userProfile.update({
      where: { id: owner },
      data: { trialEndsAt: new Date(Date.now() + 60 * 60_000) },
    })
    const resumeAccounting = createAiAccounting(db)
    const matchAccounting = createAiAccounting(
      db,
      MATCH_AI_CONFIG,
      "job_match_v1",
      "discovery"
    )

    await db.userProfile.update({
      where: { id: owner },
      data: { emailVerifiedAt: null },
    })
    const unverified = (await liveRuns(owner, "unverified", 1))[0]
    await assert.rejects(
      resumeAccounting.reserve(unverified),
      (error) =>
        error instanceof AllowanceError &&
        error.code === "email_verification_required"
    )
    await db.userProfile.update({
      where: { id: owner },
      data: {
        emailVerifiedAt: new Date(),
        trialEndsAt: new Date(Date.now() - 1000),
      },
    })
    const expired = (await liveRuns(owner, "expired", 1))[0]
    await assert.rejects(
      resumeAccounting.reserve(expired),
      (error) =>
        error instanceof AllowanceError &&
        error.code === "subscription_required"
    )

    await db.userProfile.update({
      where: { id: owner },
      data: { trialEndsAt: new Date(Date.now() + 60 * 60_000) },
    })
    await expectConcurrentCap(
      resumeAccounting,
      await liveRuns(owner, "trial-resume", 5),
      2
    )
    await expectConcurrentCap(
      matchAccounting,
      await liveRuns(owner, "trial-match", 6),
      5
    )
    // Simulate settled provider outcomes so trial-period spend is no longer held
    // against the new paid period's reservation budget.
    await db.aiUsageReservation.updateMany({
      where: { ownerUserId: owner, status: "reserved" },
      data: { status: "settled", consumedUnits: 1, finalCostMicroUsd: 0 },
    })

    await addPlusSubscription(owner, customerId)
    await expectConcurrentCap(
      resumeAccounting,
      await liveRuns(owner, "plus-resume", 6),
      5
    )
    await expectConcurrentCap(
      matchAccounting,
      await liveRuns(owner, "plus-match", 61),
      60
    )
  }))

test("discovery scans and concurrent watch mutations obey trial then Plus caps", async () =>
  fixture(async ({ owner, customerId }) => {
    const suffix = randomUUID()
    let companyId: string | null = null
    let resumeId: string | null = null
    try {
      await db.userProfile.update({
        where: { id: owner },
        data: {
          onboardingCompletedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 60 * 60_000),
        },
      })
      const company = await db.company.create({
        data: { name: `Billing Cap ${suffix}`, slug: `billing-cap-${suffix}` },
      })
      companyId = company.id
      const fixtureCompanyId = company.id
      const boards = await db.atsBoard.createManyAndReturn({
        data: Array.from({ length: 31 }, (_, index) => ({
          companyId: fixtureCompanyId,
          provider: "greenhouse" as const,
          slug: `billing-cap-${suffix}-${index}`,
        })),
      })

      const resume = await db.resume.create({
        data: { ownerUserId: owner, title: "Cap test resume" },
      })
      resumeId = resume.id
      const version = await db.resumeVersion.create({
        data: {
          ownerUserId: owner,
          resumeId: resume.id,
          version: 1,
          source: "manual",
          status: "ready",
          data: {
            contact: {
              name: "Cap Test",
              email: null,
              phone: null,
              location: null,
              links: [],
            },
            summary: "Software engineer",
            skills: ["TypeScript"],
            employment: [],
            education: [],
            credentials: [],
          },
        },
      })
      await db.resume.update({
        where: { id: resume.id },
        data: { confirmedVersionId: version.id, confirmedAt: new Date() },
      })
      await db.targetPreference.create({
        data: {
          ownerUserId: owner,
          targetTitle: "Software Engineer",
          location: "Remote",
          remotePreferred: true,
          keywords: ["TypeScript"],
        },
      })

      const user = {
        id: owner,
        name: "Billing test",
        email: `${owner}@example.test`,
        emailVerified: true,
      } as CurrentAuthUser
      const discovery = createDiscoveryService(db)
      const trialWatchResults = await Promise.allSettled(
        boards.slice(0, 5).map((board) =>
          discovery.mutate(user, {
            action: "watch",
            boardId: board.id,
            watching: true,
          })
        )
      )
      assert.equal(
        trialWatchResults.filter((result) => result.status === "fulfilled")
          .length,
        3
      )
      for (const result of trialWatchResults) {
        if (result.status === "rejected")
          assert.equal((result.reason as Error).message, "watch_limit")
      }
      assert.equal(
        await db.companyWatch.count({ where: { ownerUserId: owner } }),
        3
      )

      const worker = createDiscoveryWorker(
        db,
        async () => {
          throw new Error("matcher_unexpected")
        },
        async () => []
      )
      await worker.plan(owner)
      const today = new Date(
        `${new Date().toISOString().slice(0, 10)}T00:00:00Z`
      )
      const allowanceKey = { ownerUserId: owner, periodStart: today }
      await db.discoveryAllowance.update({
        where: { ownerUserId_periodStart: allowanceKey },
        data: { lastScannedAt: new Date(Date.now() - 13 * 60 * 60_000) },
      })
      await Promise.all(Array.from({ length: 5 }, () => worker.plan(owner)))
      let allowance = await db.discoveryAllowance.findUniqueOrThrow({
        where: { ownerUserId_periodStart: allowanceKey },
      })
      assert.equal(allowance.scans, 2)

      await addPlusSubscription(owner, customerId)
      const priorWatches = await db.companyWatch.findMany({
        where: { ownerUserId: owner },
        select: { boardId: true },
      })
      const priorWatchIds = new Set(priorWatches.map((watch) => watch.boardId))
      const paidWatchResults: PromiseSettledResult<
        Awaited<ReturnType<typeof discovery.mutate>>
      >[] = []
      const paidWatchCandidates = boards.filter(
        (board) => !priorWatchIds.has(board.id)
      )
      for (let start = 0; start < paidWatchCandidates.length; start += 8) {
        paidWatchResults.push(
          ...(await Promise.allSettled(
            paidWatchCandidates.slice(start, start + 8).map((board) =>
              discovery.mutate(user, {
                action: "watch",
                boardId: board.id,
                watching: true,
              })
            )
          ))
        )
      }
      assert.equal(
        paidWatchResults.filter((result) => result.status === "fulfilled")
          .length,
        27
      )
      for (const result of paidWatchResults) {
        if (result.status === "rejected")
          assert.equal((result.reason as Error).message, "watch_limit")
      }
      assert.equal(
        await db.companyWatch.count({ where: { ownerUserId: owner } }),
        30
      )

      await db.discoveryAllowance.update({
        where: { ownerUserId_periodStart: allowanceKey },
        data: { lastScannedAt: new Date(Date.now() - 13 * 60 * 60_000) },
      })
      await Promise.all(Array.from({ length: 3 }, () => worker.plan(owner)))
      allowance = await db.discoveryAllowance.findUniqueOrThrow({
        where: { ownerUserId_periodStart: allowanceKey },
      })
      assert.equal(allowance.scans, 2)
    } finally {
      await db.companyWatch.deleteMany({ where: { ownerUserId: owner } })
      await db.targetPreference.deleteMany({ where: { ownerUserId: owner } })
      if (resumeId) {
        await db.resume.update({
          where: { id: resumeId },
          data: { confirmedVersionId: null, confirmedAt: null },
        })
        await db.resumeVersion.deleteMany({ where: { ownerUserId: owner } })
        await db.resume.delete({ where: { id: resumeId } })
      }
      await db.discoveryAllowance.deleteMany({ where: { ownerUserId: owner } })
      if (companyId) {
        await db.atsBoard.deleteMany({ where: { companyId } })
        await db.company.delete({ where: { id: companyId } })
      }
    }
  }))

test("pure entitlement selection enforces active periods, verified trial access and stable AI limits", () => {
  const now = new Date("2026-10-01T12:00:00.000Z")
  const profile = {
    emailVerifiedAt: now,
    trialStartedAt: new Date(now.getTime() - 86_400_000),
    trialEndsAt: new Date(now.getTime() + 86_400_000),
  }
  const common = {
    customerId: "customer",
    stripePriceId: config.STRIPE_PLUS_PRICE_ID,
    status: "active",
    eligible: true,
    currentPeriodStart: new Date(now.getTime() - 1000),
    currentPeriodEnd: new Date(now.getTime() + 1000),
    cancelAtPeriodEnd: false,
    stripeCreatedAt: new Date(now.getTime() - 2000),
    lastEventId: "evt_test",
    reconciledAt: now,
  }
  const plus = resolveEntitlement(
    profile,
    [
      { ...common, stripeSubscriptionId: "sub_current" },
      {
        ...common,
        stripeSubscriptionId: "sub_expired",
        currentPeriodEnd: new Date(now.getTime() - 1),
        stripeCreatedAt: new Date(now.getTime() + 1000),
      },
    ],
    now
  )
  assert.equal(plus.plan, "plus")
  assert.deepEqual(plus.limits, {
    resumeRuns: 5,
    jobAnalyses: 60,
    watches: 30,
    dailyScans: 2,
    costMicroUsd: BigInt(1_500_000),
  })
  assert.equal(
    resolveEntitlement({ ...profile, emailVerifiedAt: null }, [], now).plan,
    "expired"
  )
  assert.deepEqual(
    resolveEntitlement(
      { ...profile, trialEndsAt: new Date(now.getTime() - 1) },
      [],
      now
    ).limits,
    null
  )
})
