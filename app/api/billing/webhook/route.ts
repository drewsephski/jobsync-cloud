import { db } from "@/lib/db"
import { billingConfig } from "@/lib/billing/config"
import { stripeClient } from "@/lib/billing/stripe"
import { createBillingService } from "@/lib/billing/service"
export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    const config = billingConfig()
    const stripe = stripeClient()
    const signature = request.headers.get("stripe-signature")
    if (!signature)
      return Response.json({ error: "invalid_signature" }, { status: 400 })
    const reader = request.body?.getReader()
    if (!reader)
      return Response.json({ error: "invalid_signature" }, { status: 400 })
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1_000_000)
          return Response.json({ error: "payload_too_large" }, { status: 413 })
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const body = Buffer.concat(chunks)
    let event
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        config.STRIPE_WEBHOOK_SECRET
      )
    } catch {
      return Response.json({ error: "invalid_signature" }, { status: 400 })
    }
    if (event.livemode !== config.livemode)
      return Response.json({ error: "billing_mode_mismatch" }, { status: 400 })
    return Response.json(
      await createBillingService(db, stripe, config).webhook(event)
    )
  } catch {
    // No acknowledgement on incomplete reconciliation: Stripe retries delivery.
    console.error("Stripe webhook reconciliation failed")
    return Response.json({ error: "billing_unavailable" }, { status: 503 })
  }
}
