import "server-only"
import { randomUUID } from "node:crypto"
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
      throw new UploadError("invalid_origin", 403)
    await ensureUserProfile(user)
    return Response.json(await operation(user), { status, headers })
  } catch (error) {
    const errorId = randomUUID()
    // Record handled failures too. Never include request bodies, cookies, file
    // names, signed URLs or raw driver/provider errors in runtime logs.
    console.warn(
      JSON.stringify({
        event: "resume_upload_request_failed",
        errorId,
        status: error instanceof UploadError ? error.status : 503,
        code: error instanceof UploadError ? error.code : "service_unavailable",
      })
    )
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
