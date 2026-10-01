import { privateRead } from "@/lib/backend/private-read"
import { AppShell } from "@/components/ui/app-shell"
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
  const { user, profile } = await requireCurrentProfile()
  const plan = await privateRead(() => billingSummary(db, user.id))
  const planLabel = !plan.verified
    ? "Verify email to start your 14-day trial"
    : plan.plan === "plus"
      ? "JobSync Plus"
      : plan.plan === "trial"
        ? `Trial ends ${new Date(plan.periodEnd!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
        : "Trial ended · view plan in Settings"
  return (
    <AppShell
      planLabel={planLabel}
      name={profile.displayName ?? user.name ?? "Your workspace"}
      complete={!!profile.onboardingCompletedAt}
    >
      {children}
    </AppShell>
  )
}
