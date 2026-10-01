import { ArrowRight, Check } from "lucide-react"
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
import { Item, ItemContent, ItemTitle, ItemGroup } from "@/components/ui/item"
import { Badge } from "@/components/ui/badge"
import {
  billingMode,
  billingRolloutReady,
  PLAN_LIMITS,
} from "@/lib/billing/entitlements"
export const metadata = { title: "Pricing" }
export default function Pricing() {
  const liveBilling = billingMode() && billingRolloutReady()
  return (
    <PublicShell>
      <FieldGroup className="gap-10">
        <FieldGroup className="max-w-2xl gap-5">
          <Badge variant="neutral" className="w-fit">
            Simple plans. Clear allowances.
          </Badge>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-5xl tracking-tight sm:text-6xl"
          >
            Start with 14 days.
            <br />
            Keep going for $6.
          </CardTitle>
          <CardDescription className="text-lg">
            Try the complete workspace. Your trial starts after email
            verification, without a card or an automatic charge.
          </CardDescription>
        </FieldGroup>
        <FieldGroup className="grid gap-7 md:grid-cols-2">
          {(["trial", "plus"] as const).map((plan) => (
            <Card key={plan}>
              <CardHeader>
                <CardTitle className="text-2xl">
                  {plan === "trial" ? "14-day trial" : "JobSync Plus"}
                </CardTitle>
                <CardTitle className="py-3 text-5xl">
                  {plan === "trial" ? "$0" : "$6"}
                  <CardDescription className="mt-2 text-sm">
                    {plan === "trial"
                      ? "one trial per verified account"
                      : "USD per month · cancel anytime"}
                  </CardDescription>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ItemGroup className="gap-2">
                  {[
                    "Application tracking, notes, and follow-ups",
                    "Resume review, editing, and version history",
                    `${PLAN_LIMITS[plan].resumeRuns} resume AI runs ${plan === "trial" ? "over your trial" : "per billing month"}`,
                    `${PLAN_LIMITS[plan].jobAnalyses} job AI analyses ${plan === "trial" ? "over your trial" : "per billing month"}`,
                    `Watch up to ${PLAN_LIMITS[plan].watches} company boards`,
                    `Up to ${PLAN_LIMITS[plan].dailyScans} discovery scans a day`,
                  ].map((text) => (
                    <Item key={text} className="px-0">
                      <Check className="size-4 shrink-0" />
                      <ItemContent>
                        <ItemTitle>{text}</ItemTitle>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </CardContent>
              <CardFooter>
                <LinkButton
                  className="w-full"
                  href={
                    plan === "trial"
                      ? "/auth/sign-up"
                      : "/dashboard/settings?tab=plan"
                  }
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
        <Card>
          <CardHeader>
            <CardTitle>What happens after the trial?</CardTitle>
            <CardDescription>
              {liveBilling
                ? "Choose Plus to continue AI, discovery, and workspace edits after your trial. Subscribing is a separate choice; your trial never charges automatically."
                : "Plus upgrades are being prepared. Live charging is currently disabled. Your existing tracking and resume editing remain available during this rollout; trial AI and discovery allowances still apply."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-4">
              <CardDescription>
                Plus allowances reset each subscription billing month. Trial
                allowances cover the full 14 days. Unused allowances do not roll
                over. AI and discovery can pause for service availability or
                spend safeguards. AI use is counted when processing starts,
                including unresolved provider results. Job AI analysis is also
                limited to three starts per UTC day.
              </CardDescription>
              <CardDescription>
                Discovery checks supported public company boards; it does not
                search every job site. Results may take a background refresh to
                appear. JobSync does not apply to jobs for you.
              </CardDescription>
              <CardDescription>
                Subscribing is a separate choice. Cancel through Settings →
                Manage billing to keep Plus through the end of your paid period.
              </CardDescription>
            </FieldGroup>
          </CardContent>
        </Card>
      </FieldGroup>
    </PublicShell>
  )
}
