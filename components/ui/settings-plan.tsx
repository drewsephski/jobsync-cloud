"use client"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { FieldGroup } from "./field"
import { Alert, AlertDescription } from "./alert"
import { LinkButton } from "./link-button"
import { BillingActions } from "@/components/billing-actions"
import type { billingSummary } from "@/lib/billing/service"
type Summary = Awaited<ReturnType<typeof billingSummary>>
export function SettingsPlan({
  summary,
  manage,
  upgrade,
  checkout,
}: {
  summary: Summary
  manage: boolean
  upgrade: boolean
  checkout?: string
}) {
  const paymentProblem = [
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ].includes(summary.subscriptionStatus ?? "")
  return (
    <FieldGroup>
      {checkout && (
        <Alert className="mb-5" role="status">
          <AlertDescription>
            {checkout === "success"
              ? summary.plan === "plus"
                ? "Your Plus plan is active. Your current allowances are shown below."
                : "Checkout received. Your plan updates after Stripe confirms payment. Reload shortly if it is still pending."
              : "Checkout was canceled. Your current plan is unchanged."}
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {paymentProblem
              ? "Payment needs attention"
              : !summary.verified
                ? "Your trial is ready to start"
                : summary.plan === "plus"
                  ? "JobSync Plus · $6/month"
                  : summary.plan === "trial"
                    ? "Your 14-day trial"
                    : "Your trial has ended"}
          </CardTitle>
          <CardDescription>
            {!summary.verified
              ? "Verify your email to activate trial AI and discovery."
              : summary.periodEnd
                ? `${summary.cancelAtPeriodEnd ? "Cancellation scheduled. Access through" : summary.plan === "trial" ? "Trial ends" : "Current period ends"} ${new Date(summary.periodEnd).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}.`
                : "Your saved records remain available."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            {paymentProblem && (
              <Alert>
                <AlertDescription>
                  Your subscription is{" "}
                  {summary.subscriptionStatus?.replaceAll("_", " ")}. Open
                  Manage billing to check your payment method and subscription.
                  Paid allowances resume after Stripe confirms an active plan.
                </AlertDescription>
              </Alert>
            )}
            {summary.limits && (
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "Resume AI runs",
                    summary.resumeRunsUsed,
                    summary.limits.resumeRuns,
                  ],
                  [
                    "Job AI analyses",
                    summary.jobAnalysesUsed,
                    summary.limits.jobAnalyses,
                  ],
                  [
                    "Company boards watched",
                    summary.watchesUsed,
                    summary.limits.watches,
                  ],
                  [
                    "Discovery scans today · UTC",
                    summary.dailyScansUsed,
                    summary.limits.dailyScans,
                  ],
                ].map(([label, used, limit]) => (
                  <FieldGroup
                    key={label}
                    className="gap-2 border-b border-border pb-4"
                  >
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="text-xl tabular-nums">
                      {used} / {limit}
                    </CardTitle>
                  </FieldGroup>
                ))}
              </FieldGroup>
            )}
            <CardDescription>
              AI allowances apply over your trial or current billing month.
              Unused allowances do not roll over. AI processing can pause for
              service availability or spend safeguards. Job AI analysis is also
              limited to three starts per UTC day.
            </CardDescription>
            {!upgrade && summary.plan !== "plus" && (
              <Alert>
                <AlertDescription>
                  Plus upgrades are being prepared. Live charging is disabled.
                  Your existing tracking and resume editing remain available
                  during rollout; trial AI and discovery limits still apply.
                </AlertDescription>
              </Alert>
            )}
            {!summary.verified && (
              <LinkButton className="w-fit" href="/auth/verify">
                Verify email
              </LinkButton>
            )}
            <BillingActions
              manage={manage}
              upgrade={
                upgrade &&
                summary.plan !== "plus" &&
                !["past_due", "unpaid", "incomplete", "paused"].includes(
                  summary.subscriptionStatus ?? ""
                )
              }
              verified={summary.verified}
            />
            <LinkButton className="w-fit" variant="neutral" href="/pricing">
              See plan details
            </LinkButton>
          </FieldGroup>
        </CardContent>
      </Card>
    </FieldGroup>
  )
}
