import { privateRead } from "@/lib/backend/private-read"
import { redirect } from "next/navigation"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { createOnboardingService } from "@/lib/domain/onboarding/service"
import { OnboardingFlow } from "@/components/onboarding-flow"

export default async function ResumePage() {
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  const state = await privateRead(() => createOnboardingService(db).read(user))
  return (
    <OnboardingFlow
      key={`${state.upload?.id}-${state.version?.id}`}
      initialState={state}
      resumeOnly
    />
  )
}
