import "server-only"
import { getCurrentAuthUser } from "@/lib/auth/context"
import { ensureUserProfile } from "@/lib/auth/user-profile"
import type { CurrentAuthUser } from "@/lib/auth/session-context"
import { UploadError } from "@/lib/storage/upload-service"
import { serverEnv } from "@/lib/server-env"

export async function uploadApi(
  request: Request,
  operation: (user: CurrentAuthUser) => Promise<unknown>,
  status = 200
) {
  const headers = { "Cache-Control": "no-store" }
  try {
    const user = await getCurrentAuthUser()
    if (!user)
      return Response.json(
        { error: "unauthenticated" },
        { status: 401, headers }
      )
    // Session cookies authorize a capability, so reject cross-origin mutations.
    // Non-browser clients may omit Origin; browser same-origin requests send it.
    const origin = request.headers.get("origin")
    if (origin && origin !== serverEnv.APP_ORIGIN)
      return Response.json(
        { error: "invalid_origin" },
        { status: 403, headers }
      )
    await ensureUserProfile(user)
    return Response.json(await operation(user), { status, headers })
  } catch (error) {
    if (error instanceof UploadError)
      return Response.json(
        { error: error.code },
        { status: error.status, headers }
      )
    return Response.json(
      { error: "service_unavailable" },
      { status: 503, headers }
    )
  }
}
