import type {
  Prisma,
  UserProfile,
  BillingSubscription,
} from "../generated/prisma/client"
import { UploadError } from "../domain/resume-upload/service"

export const PLAN_LIMITS = {
  trial: {
    resumeRuns: 2,
    jobAnalyses: 5,
    watches: 3,
    dailyScans: 2,
    costMicroUsd: BigInt(300_000),
  },
  plus: {
    resumeRuns: 5,
    jobAnalyses: 60,
    watches: 30,
    dailyScans: 2,
    costMicroUsd: BigInt(1_500_000),
  },
} as const
export function billingMode() {
  return process.env.STRIPE_MODE === "test" ? false : true
}

// Shared SQL filter for public-board work. Private AI admission still uses the
// locked local entitlement and durable reservations at execution time.
export function discoveryEligibleOwner(
  now = new Date()
): Prisma.UserProfileWhereInput {
  return {
    deletionRequestedAt: null,
    emailVerifiedAt: { not: null },
    OR: [
      { trialStartedAt: { not: null }, trialEndsAt: { gt: now } },
      {
        billingCustomers: {
          some: {
            livemode: billingMode(),
            subscriptions: {
              some: {
                eligible: true,
                status: { in: ["active", "trialing"] },
                currentPeriodStart: { lte: now },
                currentPeriodEnd: { gt: now },
              },
            },
          },
        },
      },
    ],
  }
}
export function resolveEntitlement(
  profile: Pick<
    UserProfile,
    "emailVerifiedAt" | "trialStartedAt" | "trialEndsAt"
  >,
  subscriptions: BillingSubscription[],
  now = new Date()
) {
  const paid = subscriptions
    .filter(
      (s) =>
        s.eligible &&
        ["active", "trialing"].includes(s.status) &&
        s.currentPeriodStart <= now &&
        s.currentPeriodEnd > now
    )
    .sort(
      (a, b) => b.stripeCreatedAt.getTime() - a.stripeCreatedAt.getTime()
    )[0]
  const trial =
    !!profile.emailVerifiedAt &&
    !!profile.trialStartedAt &&
    !!profile.trialEndsAt &&
    profile.trialEndsAt > now
  const plan = paid ? "plus" : trial ? "trial" : "expired"
  return {
    plan: plan as "plus" | "trial" | "expired",
    verified: !!profile.emailVerifiedAt,
    periodStart: paid?.currentPeriodStart ?? profile.trialStartedAt,
    periodEnd: paid?.currentPeriodEnd ?? profile.trialEndsAt,
    cancelAtPeriodEnd: paid?.cancelAtPeriodEnd ?? false,
    subscriptionStatus:
      paid?.status ??
      subscriptions.sort(
        (a, b) => b.stripeCreatedAt.getTime() - a.stripeCreatedAt.getTime()
      )[0]?.status ??
      null,
    limits: plan === "expired" ? null : PLAN_LIMITS[plan],
  }
}
export async function readEntitlement(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  now = new Date()
) {
  const profile = await tx.userProfile.findUniqueOrThrow({
    where: { id: ownerUserId },
  })
  const customer = await tx.billingCustomer.findUnique({
    where: { ownerUserId_livemode: { ownerUserId, livemode: billingMode() } },
    include: { subscriptions: true },
  })
  if (profile.deletionRequestedAt) throw new UploadError("account_deleting", 403)
  return resolveEntitlement(profile, customer?.subscriptions ?? [], now)
}
export async function requireEntitlement(
  tx: Prisma.TransactionClient,
  ownerUserId: string
) {
  const entitlement = await readEntitlement(tx, ownerUserId)
  if (!entitlement.verified)
    throw new UploadError("email_verification_required", 403)
  if (!entitlement.limits) throw new UploadError("subscription_required", 402)
  return entitlement
}

// Staged rollout preserves existing core records/edits until working billing is
// configured and proven. It grants no Plus status and never relaxes AI admission.
export function billingRolloutReady() {
  return process.env.BILLING_ROLLOUT_READY === "true"
}
export async function requireCoreEntitlement(
  tx: Prisma.TransactionClient,
  ownerUserId: string
) {
  const profile = await tx.userProfile.findUnique({ where: { id: ownerUserId } })
  if (!profile || profile.deletionRequestedAt) throw new UploadError("account_deleting", 403)
  if (billingRolloutReady() && billingMode())
    await requireEntitlement(tx, ownerUserId)
}

// A deployed sandbox can exercise billing only for explicitly isolated identities.
export function testBillingAllowed(ownerUserId: string) {
  return (process.env.BILLING_TEST_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .includes(ownerUserId)
}

export function billingCheckoutAvailable(ownerUserId: string) {
  return billingMode() ? billingRolloutReady() : testBillingAllowed(ownerUserId)
}
