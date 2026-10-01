import "server-only"
import { db } from "@/lib/db"
import { getCurrentAuthUser } from "@/lib/auth/context"
import { ensureUserProfile } from "@/lib/auth/user-profile"
import { serverEnv } from "@/lib/server-env"
import { UploadError } from "@/lib/domain/resume-upload/service"
import { billingCheckoutAvailable } from "./entitlements"
import { billingConfig } from "./config"
import { stripeClient } from "./stripe"
import { createBillingService } from "./service"
export async function billingAction(
  request: Request,
  action: "checkout" | "portal"
) {
  const headers = { "Cache-Control": "no-store" }
  try {
    // These endpoints are browser-cookie mutations; require the exact origin.
    if (request.headers.get("origin") !== serverEnv.APP_ORIGIN)
      return Response.json(
        { error: "invalid_origin" },
        { status: 403, headers }
      )
    const user = await getCurrentAuthUser()
    if (!user)
      return Response.json(
        { error: "unauthenticated" },
        { status: 401, headers }
      )
    if (action === "checkout" && !billingCheckoutAvailable(user.id))
      return Response.json(
        { error: "billing_unavailable" },
        { status: 503, headers }
      )
    await ensureUserProfile(user)
    const service = createBillingService(db, stripeClient(), billingConfig())
    return Response.json({ url: await service[action](user) }, { headers })
  } catch (error) {
    if (error instanceof UploadError)
      return Response.json(
        { error: error.code },
        { status: error.status, headers }
      )
    return Response.json(
      { error: "billing_unavailable" },
      { status: 503, headers }
    )
  }
}
