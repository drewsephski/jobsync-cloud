import { db } from "@/lib/db"
import { uploadApi } from "@/lib/storage/api"
import { UploadError } from "@/lib/domain/resume-upload/service"
import { createApplicationService } from "@/lib/domain/applications/service"
export const runtime = "nodejs"
const service = createApplicationService(db)
export async function GET(request: Request) {
  return uploadApi(request, (user) => service.read(user))
}
export async function POST(request: Request) {
  return uploadApi(request, async (user) => {
    const reader = request.body?.getReader()
    if (!reader) throw new UploadError("invalid_input", 400)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 60_000) throw new UploadError("invalid_input", 400)
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    let value: unknown
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      throw new UploadError("invalid_input", 400)
    }
    return service.mutate(user, value)
  })
}
