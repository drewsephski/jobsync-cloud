import { privateRead } from "@/lib/backend/private-read"
import { redirect } from "next/navigation"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { createOnboardingService } from "@/lib/domain/onboarding/service"
import { OnboardingFlow } from "@/components/onboarding-flow"

export default async function OnboardingPage() {
  const { user, profile } = await requireCurrentProfile()
  if (profile.onboardingCompletedAt) redirect("/dashboard")
  const state = await privateRead(() => createOnboardingService(db).read(user))
  if (state.completedAt) redirect("/dashboard")
  return (
    <OnboardingFlow
      key={`${state.upload?.id}-${state.version?.id}-${state.step}-${state.preferenceRevision}`}
      initialState={state}
    />
  )
}
