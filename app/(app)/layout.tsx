import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { CardDescription } from "@/components/ui/card"
import { billingRolloutReady, billingMode } from "@/lib/billing/entitlements"
import { billingSummary } from "@/lib/billing/service"
import { db } from "@/lib/db"
import { requireCurrentProfile } from "@/lib/auth/context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = await requireCurrentProfile()
  const plan = await billingSummary(db, user.id)
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <FieldGroup className="onboarding-surface flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <CardDescription>
          {!plan.verified
            ? "Verify your email to start your trial"
            : plan.plan === "plus"
              ? "JobSync Plus"
              : plan.plan === "trial"
                ? `Free trial · ends ${new Date(plan.periodEnd!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
                : billingRolloutReady() && billingMode()
                  ? "Trial ended · saved records remain available"
                  : "Trial ended · core tracking remains available during billing setup"}
        </CardDescription>
        <Button
          variant="neutral"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard/billing" />}
        >
          Account & billing
        </Button>
      </FieldGroup>
      {children}
    </main>
  )
}
