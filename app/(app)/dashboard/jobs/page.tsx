import { redirect } from "next/navigation"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { createApplicationService } from "@/lib/domain/applications/service"
import { ApplicationTracker } from "@/components/application-tracker"
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string }>
}) {
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  const params = await searchParams
  return (
    <ApplicationTracker
      initial={await createApplicationService(db).read(user)}
      initialId={params.application}
    />
  )
}
