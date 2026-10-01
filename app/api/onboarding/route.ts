import { db } from "@/lib/db"
import { uploadApi } from "@/lib/storage/api"
import { UploadError } from "@/lib/storage/upload-service"
import { createOnboardingService } from "@/lib/domain/onboarding/service"

export const runtime = "nodejs"
const service = createOnboardingService(db)
export async function GET(request: Request) {
  return uploadApi(request, (user) => service.read(user))
}
export async function POST(request: Request) {
  return uploadApi(request, async (user) => {
    // Bound semantic payloads before JSON parsing. No client ownership fields accepted.
    const reader = request.body?.getReader()
    if (!reader) throw new UploadError("invalid_input", 400)
    const decoder = new TextDecoder()
    let text = ""
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 250_000) {
          await reader.cancel()
          throw new UploadError("invalid_input", 400)
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new UploadError("invalid_input", 400)
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("action" in value) ||
      !("input" in value) ||
      Object.keys(value).length !== 2
    )
      throw new UploadError("invalid_input", 400)
    const { action, input } = value
    if (action === "save") return service.save(user, input)
    if (action === "confirm") return service.confirm(user, input)
    if (action === "preferences") return service.preferences(user, input)
    throw new UploadError("invalid_input", 400)
  })
}
