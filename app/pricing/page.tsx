import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Item, ItemContent, ItemTitle, ItemGroup } from "@/components/ui/item"
import { PLAN_LIMITS } from "@/lib/billing/entitlements"
export default function Pricing() {
  return (
    <FieldGroup className="onboarding-surface discovery-surface mx-auto max-w-4xl gap-7 px-6 py-14">
      <CardTitle role="heading" aria-level={1} className="text-4xl">
        A calmer job search, for $6 a month.
      </CardTitle>
      <CardDescription>
        Keep your applications, confirmed resume, and relevant opportunities
        together. Start with a bounded free trial. No card required.
      </CardDescription>
      <FieldGroup className="grid gap-6 md:grid-cols-2">
        {(["trial", "plus"] as const).map((plan) => (
          <Card key={plan}>
            <CardHeader>
              <CardTitle>
                {plan === "trial" ? "14-day free trial" : "JobSync Plus"}
              </CardTitle>
              <CardDescription>
                {plan === "trial"
                  ? "One trial per verified account"
                  : "$6 USD / month · cancel anytime"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-5">
                <ItemGroup>
                  {[
                    "Application tracking and confirmed resumes",
                    `${PLAN_LIMITS[plan].resumeRuns} resume AI runs ${plan === "trial" ? "total" : "per billing month"}`,
                    `${PLAN_LIMITS[plan].jobAnalyses} job AI analyses ${plan === "trial" ? "total" : "per billing month"}`,
                    `Watch up to ${PLAN_LIMITS[plan].watches} companies`,
                    "Up to 2 discovery scans per day",
                    plan === "plus"
                      ? "Recurring discovery and future Plus features"
                      : "Try the complete cloud workflow",
                  ].map((text) => (
                    <Item key={text}>
                      <ItemContent>
                        <ItemTitle className="font-normal">{text}</ItemTitle>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      href={
                        plan === "trial"
                          ? "/auth/sign-up"
                          : "/dashboard/billing"
                      }
                    />
                  }
                >
                  {plan === "trial" ? "Start your trial" : "Get Plus"}
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>
        ))}
      </FieldGroup>
      <CardDescription>
        Trial allowances apply across the full 14 days. Plus AI allowances reset
        each subscription billing month. No automatic charge after the free
        trial. AI and discovery remain subject to service availability and spend
        safeguards; unused allowances do not roll over. Cancel in the billing
        portal to keep Plus through the end of your paid period. After expiry,
        saved records remain available to review.
      </CardDescription>
      <Button
        variant="neutral"
        nativeButton={false}
        render={<Link href="/dashboard" />}
      >
        Back to JobSync
      </Button>
    </FieldGroup>
  )
}
