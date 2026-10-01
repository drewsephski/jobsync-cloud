import Link from "next/link"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { billingSummary } from "@/lib/billing/service"
import {
  billingMode,
  billingCheckoutAvailable,
  testBillingAllowed,
} from "@/lib/billing/entitlements"
import { BillingActions } from "@/components/billing-actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const { user } = await requireCurrentProfile()
  const [summary, customer, params] = await Promise.all([
    billingSummary(db, user.id),
    db.billingCustomer.findUnique({
      where: {
        ownerUserId_livemode: { ownerUserId: user.id, livemode: billingMode() },
      },
    }),
    searchParams,
  ])
  const ready = billingCheckoutAvailable(user.id)
  const date = summary.periodEnd
    ? new Date(summary.periodEnd).toLocaleDateString("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : null
  const paymentProblem = [
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ].includes(summary.subscriptionStatus ?? "")
  return (
    <FieldGroup className="onboarding-surface discovery-surface gap-6 py-6 sm:px-4">
      <FieldGroup className="flex-row flex-wrap justify-between gap-3">
        <CardTitle role="heading" aria-level={1} className="text-3xl">
          Account & billing
        </CardTitle>
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          Your dashboard
        </Button>
      </FieldGroup>
      {!billingMode() && testBillingAllowed(user.id) && (
        <CardDescription>
          Test billing account · Stripe test mode. No live charges.
        </CardDescription>
      )}
      {!ready && (
        <CardDescription>
          Plus upgrades are being set up. Your existing application tracking and
          resume editing remain available. Trial AI and discovery allowances
          still apply.
        </CardDescription>
      )}
      {params.checkout === "success" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {summary.plan === "plus"
                ? "Welcome to Plus."
                : "Confirming your subscription."}
            </CardTitle>
            <CardDescription>
              {summary.plan === "plus"
                ? "Your payment is confirmed and Plus is ready."
                : "Stripe has returned you to JobSync. Access updates after we receive the verified payment confirmation. Refresh this page shortly."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {params.checkout === "canceled" && (
        <CardDescription>
          Checkout was canceled. Your current plan is shown below.
        </CardDescription>
      )}
      {!summary.verified && (
        <Card>
          <CardHeader>
            <CardTitle>Verify your email to start your trial.</CardTitle>
            <CardDescription>
              Your 14-day trial begins after verification.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button nativeButton={false} render={<Link href="/auth/verify" />}>
              Verify email
            </Button>
          </CardContent>
        </Card>
      )}
      {paymentProblem && (
        <Card>
          <CardHeader>
            <CardTitle>Payment needs attention.</CardTitle>
            <CardDescription>
              Plus is paused while your subscription is{" "}
              {summary.subscriptionStatus?.replaceAll("_", " ")}. Update your
              payment method in Manage billing. Your saved records remain
              available.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader>
          <FieldGroup className="flex-row items-center justify-between">
            <CardTitle>
              {summary.plan === "plus"
                ? "JobSync Plus"
                : summary.plan === "trial"
                  ? "Your free trial"
                  : "Trial ended"}
            </CardTitle>
            <Badge variant="neutral">
              {summary.plan === "plus"
                ? "$6 / month"
                : "No card needed for trial"}
            </Badge>
          </FieldGroup>
          <CardDescription>
            {summary.plan === "plus"
              ? `${summary.cancelAtPeriodEnd ? "Cancellation scheduled. Plus continues through" : "Current paid period ends"} ${date}.`
              : summary.plan === "trial"
                ? `Trial ends ${date}. Upgrade whenever you’re ready.`
                : "Your records are available to review. Upgrade to continue tracking, resume editing, and discovery."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-5">
            {summary.limits && (
              <FieldGroup className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardContent className="pt-4">
                    <CardTitle className="text-xl">
                      {summary.resumeRunsUsed} / {summary.limits.resumeRuns}
                    </CardTitle>
                    <CardDescription>
                      Resume AI runs{" "}
                      {summary.plan === "trial"
                        ? "in this trial"
                        : "in this billing period"}
                    </CardDescription>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <CardTitle className="text-xl">
                      {summary.jobAnalysesUsed} / {summary.limits.jobAnalyses}
                    </CardTitle>
                    <CardDescription>
                      Job AI analyses{" "}
                      {summary.plan === "trial"
                        ? "in this trial"
                        : "in this billing period"}
                    </CardDescription>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <CardTitle className="text-xl">
                      {summary.watchesUsed} / {summary.limits.watches}
                    </CardTitle>
                    <CardDescription>Companies watched</CardDescription>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <CardTitle className="text-xl">
                      {summary.dailyScansUsed} / {summary.limits.dailyScans}
                    </CardTitle>
                    <CardDescription>
                      Discovery scans today · UTC
                    </CardDescription>
                  </CardContent>
                </Card>
              </FieldGroup>
            )}
            <CardDescription>
              {summary.limits
                ? `Watch up to ${summary.limits.watches} companies. Up to ${summary.limits.dailyScans} discovery scans per day. `
                : ""}
              AI is included within these allowances; temporary service or spend
              safeguards can pause processing. AI use is counted when processing
              starts, including an unresolved provider result.
            </CardDescription>
            <BillingActions
              manage={
                !!customer?.stripeCustomerId &&
                (billingMode() || testBillingAllowed(user.id))
              }
              upgrade={ready && summary.plan !== "plus" && !paymentProblem}
              verified={summary.verified}
            />
            <Button
              variant="neutral"
              nativeButton={false}
              render={<Link href="/pricing" />}
            >
              See plan details
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your account</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link href="/auth/forgot-password" />}
          >
            Reset password
          </Button>
        </CardContent>
      </Card>
    </FieldGroup>
  )
}
