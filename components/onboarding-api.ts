import type { OnboardingState } from "@/lib/domain/onboarding/service"

export class OnboardingRequestError extends Error {
  constructor(
    public code: string,
    public status: number
  ) {
    super(code)
  }
}
export async function onboardingRequest(
  action?: string,
  input?: unknown
): Promise<OnboardingState> {
  const response = await fetch("/api/onboarding", {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    ...(action
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, input }),
        }
      : {}),
  })
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "service_unavailable" }))
    throw new OnboardingRequestError(body.error, response.status)
  }
  return response.json()
}
export function onboardingError(error: unknown) {
  if (error instanceof OnboardingRequestError) {
    if (error.code === "subscription_required")
      return "Your trial or subscription ended. Open Account & billing to continue. Your saved resume is still available."
    if (error.code === "email_verification_required")
      return "Verify your email in Account & billing to start your trial."
    if (error.status === 409)
      return "This resume or your preferences changed in another tab or device. Your unsaved changes are still here. Load the latest saved version before continuing."
    if (error.status === 401)
      return "Your session expired. Sign in again, then return here."
    if (error.code === "resume_incomplete")
      return "Add your name and at least one resume section before confirming."
    if (error.status === 400)
      return "Check the fields and try again. Some information is missing or too long."
    if (error.status === 404)
      return "This resume is no longer available to your account. Load the latest saved version."
  }
  return "We couldn’t save your changes. Check your connection and try again. Your edits are still here."
}
