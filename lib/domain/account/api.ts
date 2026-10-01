import "server-only"
import { z } from "zod"
import { db } from "../../db"
import { auth } from "../../auth/server"
import { getCurrentAuthUser } from "../../auth/context"
import { ensureUserProfile } from "../../auth/user-profile"
import { serverEnv } from "../../server-env"
import { UploadError } from "../resume-upload/service"
import { exportAccount } from "./export"
import { createAccountDeletion } from "./deletion"
import { accountCleanup } from "./providers"

export async function accountApi(
  request: Request,
  action: "export" | "delete" | "profile"
) {
  const headers = {
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  }
  try {
    if (
      request.method !== "GET" &&
      request.headers.get("origin") !== serverEnv.APP_ORIGIN
    )
      throw new UploadError("invalid_origin", 403)
    const user = await getCurrentAuthUser()
    if (!user) throw new UploadError("unauthenticated", 401)
    await ensureUserProfile(user)
    if (action === "export") {
      const data = await exportAccount(db, user)
      return new Response(
        JSON.stringify(data, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        ),
        {
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="jobsync-cloud-export.json"',
          },
        }
      )
    }
    const reader = request.body?.getReader()
    if (!reader) throw new UploadError("invalid_input", 400)
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 4096) {
          await reader.cancel()
          throw new UploadError("invalid_input", 400)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    let input: unknown
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      throw new UploadError("invalid_input", 400)
    }
    if (action === "profile") {
      const parsed = z
        .strictObject({
          displayName: z.string().trim().min(1).max(200),
          timezone: z
            .string()
            .max(100)
            .refine((v) => {
              try {
                new Intl.DateTimeFormat("en", { timeZone: v })
                return true
              } catch {
                return false
              }
            }),
        })
        .safeParse(input)
      if (!parsed.success) throw new UploadError("invalid_input", 400)
      await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "UserProfile" WHERE id=${user.id} AND "deletionRequestedAt" IS NULL FOR NO KEY UPDATE`
        if (!rows.length) throw new UploadError("account_deleting", 403)
        await tx.userProfile.update({
          where: { id: user.id },
          data: parsed.data,
        })
      })
      return Response.json({ saved: true }, { headers })
    }
    const parsed = z
      .strictObject({
        confirmation: z.literal("DELETE MY ACCOUNT"),
        password: z.string().min(1).max(128),
      })
      .safeParse(input)
    if (!parsed.success) throw new UploadError("confirmation_required", 400)
    if (!user.email)
      throw new UploadError("account_reauthentication_required", 403)
    // Reauthenticate deliberately. The password is never written to a record or
    // retained by the durable cleanup worker.
    const result = await auth.signIn.email({
      email: user.email,
      password: parsed.data.password,
    })
    if (result.error || result.data?.user.id !== user.id)
      throw new UploadError("account_reauthentication_required", 403)
    const service = createAccountDeletion(db, accountCleanup())
    const queued = await service.request(user.id)
    // Durable scheduled recovery finishes long/provider-dependent cleanup. The
    // first attempt can make progress immediately when no capabilities remain.
    await service.process(user.id)
    return Response.json(
      { ...queued, accepted: true },
      { status: 202, headers }
    )
  } catch (error) {
    if (error instanceof UploadError)
      return Response.json(
        { error: error.code },
        { status: error.status, headers }
      )
    return Response.json(
      { error: "account_service_unavailable" },
      { status: 503, headers }
    )
  }
}
