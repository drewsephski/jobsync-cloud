import { db } from "@/lib/db"
import { uploadApi } from "@/lib/storage/api"
import { UploadError } from "@/lib/domain/resume-upload/service"
import { createFeedbackService } from "@/lib/domain/feedback/service"
import { serverEnv } from "@/lib/server-env"
export const runtime = "nodejs"
export async function POST(request: Request) {
  return uploadApi(request, async (user) => {
    if (request.headers.get("origin") !== serverEnv.APP_ORIGIN)
      throw new UploadError("invalid_origin", 403)
    const reader = request.body?.getReader()
    if (!reader) throw new UploadError("invalid_input", 400)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 10_000) throw new UploadError("invalid_input", 400)
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    let input: unknown
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      throw new UploadError("invalid_input", 400)
    }
    return createFeedbackService(db).submit(user.id, input)
  })
}
