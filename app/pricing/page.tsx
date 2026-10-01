import { ArrowRight, Check } from "@/components/ui/animated-icons"
import { PublicShell } from "@/components/ui/public-shell"
import { LinkButton } from "@/components/ui/link-button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { ProductFaq } from "@/components/ui/product-faq"
import {
  billingMode,
  billingRolloutReady,
  PLAN_LIMITS,
} from "@/lib/billing/entitlements"
export const metadata = { title: "Pricing" }
export default function Pricing() {
  const liveBilling = billingMode() && billingRolloutReady()
  const questions = [
    [
      "Will my trial charge me automatically?",
      "No. Your trial starts after email verification, lasts 14 days, and requires no card. Subscribing is a separate choice.",
    ],
    [
      "What is included, and when do limits reset?",
      "Resume AI runs and job AI analyses cover the full trial or each subscription billing month. Company watches have a plan maximum; discovery scans reset daily. Job AI analysis is also limited to three starts per UTC day. Unused allowances do not roll over.",
    ],
    [
      "How is AI usage counted?",
      "An AI run counts when processing starts, including unresolved provider results. AI and discovery may pause for service availability or spend safeguards. Your allowance is visible in Settings.",
    ],
    [
      "Can I cancel anytime?",
      "Yes. Manage billing in Settings to cancel an active subscription. Your access continues through the paid period; cancellation does not delete your workspace.",
    ],
    [
      "What remains after the trial expires?",
      liveBilling
        ? "Your saved records, data export, and original resume downloads remain available. Plus is required to continue AI, discovery, and workspace edits after your trial."
        : "Plus subscriptions aren’t available yet. You won’t be charged. Existing tracking and resume editing remain available while subscriptions are unavailable. Trial AI and discovery allowances still apply. Saved records, export, and original downloads remain available.",
    ],
    [
      "Do I need to pay for AI separately?",
      "No API key or separate AI subscription is needed. Usage is included within the allowances shown here.",
    ],
  ] as const
  return (
    <PublicShell>
      <FieldGroup className="gap-16 sm:gap-24">
        <FieldGroup className="mx-auto max-w-2xl gap-5 text-center">
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-4xl tracking-tight sm:text-6xl"
          >
            14 days free.
            <br />
            $6/month if it helps.
          </CardTitle>
          <CardDescription className="text-lg">
            One simple plan for your next chapter.
            <br />
            No card required. No automatic trial charge.
          </CardDescription>
        </FieldGroup>
        <FieldGroup className="mx-auto max-w-4xl gap-8">
          <FieldGroup className="grid items-stretch gap-6 md:grid-cols-2">
            {(["trial", "plus"] as const).map((plan) => (
              <Card
                key={plan}
                className={plan === "plus" ? "border-main/30" : ""}
              >
                <CardHeader className="gap-3">
                  <CardTitle className="text-xl">
                    {plan === "trial" ? "Try JobSync" : "Keep going with Plus"}
                  </CardTitle>
                  <CardTitle className="text-5xl tracking-tight">
                    {plan === "trial" ? "$0" : "$6"}
                    <span className="ml-2 text-sm font-normal text-foreground/60">
                      {plan === "trial" ? "for 14 days" : "/ month"}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {plan === "trial"
                      ? "Starts when you verify your email."
                      : "USD · cancel anytime"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <FieldGroup className="gap-3">
                    {[
                      "Application tracking, notes, and follow-ups",
                      "Resume review and version history",
                      `${PLAN_LIMITS[plan].resumeRuns} resume AI runs ${plan === "trial" ? "during your trial" : "per billing month"}`,
                      `${PLAN_LIMITS[plan].jobAnalyses} job AI analyses ${plan === "trial" ? "during your trial" : "per billing month"}`,
                      `Watch up to ${PLAN_LIMITS[plan].watches} companies`,
                      `Up to ${PLAN_LIMITS[plan].dailyScans} discovery scans a day`,
                    ].map((text) => (
                      <FieldGroup
                        key={text}
                        className="flex-row items-start gap-3 text-sm"
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-main" />
                        <span>{text}</span>
                      </FieldGroup>
                    ))}
                  </FieldGroup>
                </CardContent>
                <CardFooter>
                  <LinkButton
                    className="w-full"
                    href={
                      plan === "trial"
                        ? "/auth/sign-up"
                        : "/dashboard/settings?tab=plan"
                    }
                    variant={plan === "trial" ? "default" : "neutral"}
                  >
                    {plan === "trial"
                      ? "Start your free trial"
                      : liveBilling
                        ? "Choose Plus"
                        : "View Plus availability"}
                    <ArrowRight />
                  </LinkButton>
                </CardFooter>
              </Card>
            ))}
          </FieldGroup>
          {!liveBilling && (
            <CardDescription className="text-center text-sm">
              Plus subscriptions aren’t available yet. You won’t be charged.
            </CardDescription>
          )}
        </FieldGroup>
        <ProductFaq title="Simple billing. Clear answers." items={questions} />
      </FieldGroup>
    </PublicShell>
  )
}
