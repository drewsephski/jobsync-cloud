import type { ApplicationsData } from "@/lib/domain/applications/service"
export class ApplicationApiError extends Error {
  constructor(public code: string) {
    super(
      code === "subscription_required"
        ? "Your trial or subscription ended. Open Account & billing to continue. Your saved applications are still available."
        : code === "email_verification_required"
          ? "Verify your email in Account & billing to start your trial."
          : code === "application_conflict"
            ? "This application changed in another tab. Your edits are still here. Load the latest version before saving again."
            : code === "resume_not_confirmed"
              ? "That resume version is no longer confirmed. Choose a confirmed resume and try again."
              : code === "application_date_required"
                ? "Add the date you applied."
                : code === "future_application_date"
                  ? "Application dates must be today or earlier. Use a follow-up date for a planned next step."
                  : code === "future_transition"
                    ? "Movement dates must be today or earlier. Use a follow-up date for upcoming activity."
                    : "Could not save your application. Please try again."
    )
  }
}
export async function applicationRequest(
  input: unknown
): Promise<{ applicationId: string }> {
  const response = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json()
  if (!response.ok) throw new ApplicationApiError(result.error)
  return result
}
export async function loadApplications(): Promise<ApplicationsData> {
  const response = await fetch("/api/applications", {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error("Could not refresh applications. Please try again.")
  return response.json()
}
