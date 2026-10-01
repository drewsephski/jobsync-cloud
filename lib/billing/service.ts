import type Stripe from "stripe"
import type { PrismaClient, Prisma } from "../generated/prisma/client"
import type { CurrentAuthUser } from "../auth/session-context"
import type { billingConfig } from "./config"
import { readEntitlement, testBillingAllowed } from "./entitlements"
import { UploadError } from "../domain/resume-upload/service"
type Config = ReturnType<typeof billingConfig>
const seconds = (value: number) => new Date(value * 1000)
const idOf = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : (value?.id ?? null)
export function createBillingService(
  db: PrismaClient,
  stripe: Stripe,
  config: Config
) {
  async function ownerLock(tx: Prisma.TransactionClient, owner: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234103, hashtext(${owner}))`
  }
  async function validatePrice() {
    const p = await stripe.prices.retrieve(config.STRIPE_PLUS_PRICE_ID)
    if (
      !p.active ||
      p.livemode !== config.livemode ||
      idOf(p.product) !== config.STRIPE_PLUS_PRODUCT_ID ||
      p.unit_amount !== 600 ||
      p.currency !== "usd" ||
      p.recurring?.interval !== "month" ||
      p.recurring.interval_count !== 1 ||
      p.type !== "recurring"
    )
      throw new Error("invalid_plus_price")
  }
  // This is called only by verified webhooks. Always fetch canonical state AFTER
  // acquiring the customer lock: delivery timestamps cannot order Stripe state.
  async function reconcile(
    tx: Prisma.TransactionClient,
    customer: { id: string; stripeCustomerId: string },
    event: Stripe.Event
  ) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.stripeCustomerId,
      status: "all",
      limit: 100,
      expand: ["data.latest_invoice"],
    })
    if (subscriptions.has_more)
      throw new Error("subscription_history_requires_reconciliation")
    const seen: string[] = []
    for (const s of subscriptions.data) {
      if (
        s.livemode !== config.livemode ||
        idOf(s.customer) !== customer.stripeCustomerId
      )
        throw new Error("subscription_mode_mismatch")
      const item = s.items.data[0]
      const p = item?.price
      const valid =
        s.items.data.length === 1 &&
        item.quantity === 1 &&
        p?.id === config.STRIPE_PLUS_PRICE_ID &&
        idOf(p.product) === config.STRIPE_PLUS_PRODUCT_ID &&
        p.unit_amount === 600 &&
        p.currency === "usd" &&
        p.recurring?.interval === "month" &&
        p.recurring.interval_count === 1
      const invoice =
        s.latest_invoice && typeof s.latest_invoice !== "string"
          ? s.latest_invoice
          : null
      const eligible =
        valid &&
        (s.status === "trialing" ||
          (s.status === "active" && invoice?.status === "paid"))
      const periodEnd =
        s.status === "trialing" && s.trial_end
          ? Math.min(item?.current_period_end ?? s.trial_end, s.trial_end)
          : (item?.current_period_end ?? s.created)
      // Modern portal cancellation schedules use cancel_at while the legacy
      // cancel_at_period_end flag can remain false. Never grant past that date.
      const end = s.cancel_at ? Math.min(periodEnd, s.cancel_at) : periodEnd
      const data = {
        customerId: customer.id,
        stripePriceId: p?.id ?? "unknown",
        status: s.status,
        eligible,
        currentPeriodStart: seconds(item?.current_period_start ?? s.created),
        currentPeriodEnd: seconds(end),
        cancelAtPeriodEnd: s.cancel_at_period_end || s.cancel_at != null,
        stripeCreatedAt: seconds(s.created),
        lastEventId: event.id,
        reconciledAt: new Date(),
      }
      await tx.billingSubscription.upsert({
        where: { stripeSubscriptionId: s.id },
        create: { stripeSubscriptionId: s.id, ...data },
        update: data,
      })
      seen.push(s.id)
    }
    // Absence in the authoritative customer snapshot must not leave orphan access.
    await tx.billingSubscription.updateMany({
      where: { customerId: customer.id, stripeSubscriptionId: { notIn: seen } },
      data: {
        eligible: false,
        reconciledAt: new Date(),
        lastEventId: event.id,
      },
    })
    await tx.billingCustomer.update({
      where: { id: customer.id },
      data: { reconciledAt: new Date() },
    })
  }
  async function checkout(user: CurrentAuthUser) {
    if (!config.livemode && !testBillingAllowed(user.id))
      throw new UploadError("test_billing_restricted", 403)
    await validatePrice()
    // Commit a stable provisioning identity before contacting Stripe. If a remote
    // create succeeds but the local transaction fails, metadata search recovers
    // the same customer even after Stripe's idempotency retention window.
    await db.$transaction(async (tx) => {
      await ownerLock(tx, user.id)
      const profile = await tx.userProfile.findUniqueOrThrow({
        where: { id: user.id },
      })
      if (!profile.emailVerifiedAt || !user.emailVerified)
        throw new UploadError("email_verification_required", 403)
      await tx.billingCustomer.upsert({
        where: {
          ownerUserId_livemode: {
            ownerUserId: user.id,
            livemode: config.livemode,
          },
        },
        create: { ownerUserId: user.id, livemode: config.livemode },
        update: {},
      })
    })
    return db.$transaction(
      async (tx) => {
        await ownerLock(tx, user.id)
        const profile = await tx.userProfile.findUniqueOrThrow({
          where: { id: user.id },
        })
        if (!profile.emailVerifiedAt || !user.emailVerified)
          throw new UploadError("email_verification_required", 403)
        let customer = await tx.billingCustomer.findUniqueOrThrow({
          where: {
            ownerUserId_livemode: {
              ownerUserId: user.id,
              livemode: config.livemode,
            },
          },
        })
        if (!customer.stripeCustomerId) {
          const recovered = await stripe.customers.search({
            query: `metadata['jobsync_billing_id']:'${customer.id}'`,
            limit: 10,
          })
          if (recovered.has_more || recovered.data.length > 1)
            throw new Error("ambiguous_customer_provenance")
          const created =
            recovered.data[0] ??
            (await stripe.customers.create(
              {
                email: user.email ?? undefined,
                metadata: {
                  jobsync_owner: user.id,
                  jobsync_app: "cloud",
                  jobsync_billing_id: customer.id,
                },
              },
              { idempotencyKey: `jobsync-customer:${customer.id}` }
            ))
          if (
            created.livemode !== config.livemode ||
            created.metadata.jobsync_owner !== user.id ||
            created.metadata.jobsync_billing_id !== customer.id
          )
            throw new Error("customer_provenance_mismatch")
          customer = await tx.billingCustomer.update({
            where: { id: customer.id },
            data: { stripeCustomerId: created.id },
          })
        }
        const stripeCustomerId = customer.stripeCustomerId!
        // A pending Checkout completion must not create a second paid subscription
        // while its webhook is still delayed. This Stripe read is billing-only.
        const existing = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "all",
          limit: 100,
        })
        if (
          existing.has_more ||
          existing.data.some(
            (s) => !["canceled", "incomplete_expired"].includes(s.status)
          )
        )
          throw new UploadError("subscription_exists", 409)
        if (
          customer.checkoutSessionId &&
          customer.checkoutExpiresAt &&
          customer.checkoutExpiresAt > new Date()
        ) {
          const session = await stripe.checkout.sessions.retrieve(
            customer.checkoutSessionId
          )
          if (session.status === "open" && session.url) return session.url
          if (session.status === "complete") {
            const subscriptionId = idOf(session.subscription)
            if (!subscriptionId)
              throw new UploadError("billing_sync_pending", 409)
            const subscription =
              await stripe.subscriptions.retrieve(subscriptionId)
            if (
              !["canceled", "incomplete_expired"].includes(subscription.status)
            )
              throw new UploadError("billing_sync_pending", 409)
          }
        }
        const attempt = customer.checkoutAttempt + 1
        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: stripeCustomerId,
            client_reference_id: user.id,
            line_items: [{ price: config.STRIPE_PLUS_PRICE_ID, quantity: 1 }],
            subscription_data: {
              metadata: { jobsync_owner: user.id, jobsync_app: "cloud" },
            },
            metadata: { jobsync_owner: user.id, jobsync_app: "cloud" },
            success_url: `${config.APP_ORIGIN}/dashboard/billing?checkout=success`,
            cancel_url: `${config.APP_ORIGIN}/dashboard/billing?checkout=canceled`,
            allow_promotion_codes: false,
          },
          { idempotencyKey: `jobsync-checkout:${customer.id}:${attempt}` }
        )
        if (!session.url || session.livemode !== config.livemode)
          throw new Error("invalid_checkout")
        await tx.billingCustomer.update({
          where: { id: customer.id },
          data: {
            checkoutAttempt: attempt,
            checkoutSessionId: session.id,
            checkoutUrl: session.url,
            checkoutExpiresAt: seconds(session.expires_at),
          },
        })
        return session.url
      },
      { timeout: 60_000, maxWait: 10_000 }
    )
  }
  async function portal(user: CurrentAuthUser) {
    if (!config.livemode && !testBillingAllowed(user.id))
      throw new UploadError("test_billing_restricted", 403)
    const customer = await db.billingCustomer.findUnique({
      where: {
        ownerUserId_livemode: {
          ownerUserId: user.id,
          livemode: config.livemode,
        },
      },
    })
    if (!customer?.stripeCustomerId)
      throw new UploadError("billing_customer_not_found", 404)
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${config.APP_ORIGIN}/dashboard/billing`,
      configuration: config.STRIPE_PORTAL_CONFIGURATION_ID,
    })
    return session.url
  }
  async function webhook(event: Stripe.Event) {
    if (event.livemode !== config.livemode)
      throw new UploadError("billing_mode_mismatch", 400)
    const supported =
      event.type.startsWith("customer.subscription.") ||
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
        "invoice.finalization_failed",
        "invoice.voided",
        "invoice.marked_uncollectible",
      ].includes(event.type)
    const object = event.data.object as {
      customer?: string | { id: string } | null
    }
    const customerId = idOf(object.customer ?? null)
    if (!supported || !customerId) return { ignored: true }
    return db.$transaction(
      async (tx) => {
        const customer = await tx.billingCustomer.findUnique({
          where: { stripeCustomerId: customerId },
        })
        if (!customer) {
          const remote = await stripe.customers.retrieve(customerId)
          if (!remote.deleted && remote.metadata.jobsync_app === "cloud")
            throw new Error("billing_customer_mapping_pending")
          return { ignored: true }
        }
        if (customer.livemode !== config.livemode)
          throw new UploadError("billing_mode_mismatch", 400)
        await ownerLock(tx, customer.ownerUserId)
        if (
          await tx.billingWebhookEvent.findUnique({ where: { id: event.id } })
        )
          return { duplicate: true }
        await reconcile(
          tx,
          { id: customer.id, stripeCustomerId: customerId },
          event
        )
        if (event.type === "checkout.session.async_payment_failed") {
          const session = event.data.object as Stripe.Checkout.Session
          await tx.billingCustomer.updateMany({
            where: { id: customer.id, checkoutSessionId: session.id },
            data: { checkoutExpiresAt: new Date(0) },
          })
        }
        await tx.billingWebhookEvent.create({
          data: {
            id: event.id,
            livemode: event.livemode,
            type: event.type,
            stripeCreatedAt: seconds(event.created),
            customerId,
          },
        })
        return { received: true }
      },
      { timeout: 60_000, maxWait: 10_000 }
    )
  }
  return { checkout, portal, webhook }
}
export async function billingSummary(db: PrismaClient, owner: string) {
  return db.$transaction(async (tx) => {
    const e = await readEntitlement(tx, owner)
    const day = new Date()
    day.setUTCHours(0, 0, 0, 0)
    const [watchesUsed, scans] = await Promise.all([
      tx.companyWatch.count({ where: { ownerUserId: owner } }),
      tx.discoveryAllowance.findUnique({
        where: {
          ownerUserId_periodStart: { ownerUserId: owner, periodStart: day },
        },
      }),
    ])
    const rows = e.periodStart
      ? await tx.aiUsageReservation.findMany({
          where: {
            ownerUserId: owner,
            status: { not: "released" },
            billingPeriodStart: e.periodStart,
          },
        })
      : []
    const count = (feature: string) =>
      Number(
        rows
          .filter((r) => r.feature === feature)
          .reduce((n, r) => n + (r.consumedUnits ?? r.reservedUnits), BigInt(0))
      )
    return {
      ...e,
      limits: e.limits
        ? {
            resumeRuns: e.limits.resumeRuns,
            jobAnalyses: e.limits.jobAnalyses,
            watches: e.limits.watches,
            dailyScans: e.limits.dailyScans,
          }
        : null,
      periodStart: e.periodStart?.toISOString() ?? null,
      periodEnd: e.periodEnd?.toISOString() ?? null,
      resumeRunsUsed: count("resume_structure_v1"),
      jobAnalysesUsed: count("job_match_v1"),
      watchesUsed,
      dailyScansUsed: scans?.scans ?? 0,
    }
  })
}
