export async function settingsRequest(
  path: string,
  method: string,
  input: unknown
) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.error === "account_reauthentication_required"
        ? "Check your current password and try again."
        : response.status === 409
          ? "Your settings changed in another tab. Reload this page before saving."
          : "Your changes could not be completed. Try again shortly."
    )
  return result
}
