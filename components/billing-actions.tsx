"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FieldGroup, FieldError } from "@/components/ui/field"
const messages: Record<string, string> = {
  email_verification_required: "Verify your email before upgrading.",
  subscription_exists:
    "You already have a subscription. Use Manage billing to update it.",
  billing_sync_pending:
    "Payment is being confirmed. Refresh this page in a moment.",
  billing_unavailable:
    "Billing is temporarily unavailable. Please try again later.",
}
export function BillingActions({
  manage,
  upgrade,
  verified,
}: {
  manage: boolean
  upgrade: boolean
  verified: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function start(action: "checkout" | "portal") {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok || typeof data.url !== "string")
        throw new Error(
          messages[data.error] ?? "Unable to open billing. Please try again."
        )
      const url = new URL(data.url)
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw new Error("Unable to open billing.")
      window.location.assign(url.href)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open billing.")
      setPending(false)
    }
  }
  return (
    <FieldGroup className="gap-3">
      <FieldGroup className="flex-row flex-wrap gap-3">
        {upgrade && (
          <Button
            disabled={pending || !verified}
            onClick={() => start("checkout")}
          >
            {pending ? "Opening billing…" : "Upgrade to Plus · $6/month"}
          </Button>
        )}
        {manage && (
          <Button
            variant="neutral"
            disabled={pending}
            onClick={() => start("portal")}
          >
            Manage billing
          </Button>
        )}
      </FieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
    </FieldGroup>
  )
}
