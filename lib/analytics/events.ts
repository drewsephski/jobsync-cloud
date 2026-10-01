export const productEvents = [
  "signup_started",
  "signup_completed",
  "email_verified",
  "resume_uploaded",
  "resume_confirmed",
  "find_jobs_clicked",
  "first_results_shown",
  "first_ai_result_shown",
  "first_job_saved",
  "first_application_tracked",
  "application_applied",
  "application_interview",
  "application_offer",
  "upgrade_viewed",
  "checkout_started",
  "subscription_activated",
] as const
export type ProductEvent = (typeof productEvents)[number]

// No arbitrary properties, content, identifiers or URLs can enter custom events.
export function eventProperties(elapsedMs?: number) {
  return typeof elapsedMs === "number" &&
    Number.isFinite(elapsedMs) &&
    elapsedMs >= 0 &&
    elapsedMs <= 86_400_000
    ? { elapsed_ms: Math.round(elapsedMs) }
    : undefined
}

const pages = new Set([
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/support",
  "/account-closed",
  "/auth/sign-up",
  "/auth/sign-in",
  "/auth/verify",
  "/auth/forgot-password",
  "/onboarding",
  "/dashboard",
  "/dashboard/jobs",
  "/dashboard/discover",
  "/dashboard/resume",
  "/dashboard/settings",
  "/dashboard/billing",
  "/dashboard/feedback",
])
export function analyticsUrl(value: string) {
  try {
    const url = new URL(value)
    if (!pages.has(url.pathname)) return null
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}
