import { db } from "@/lib/db"
import { uploadApi } from "@/lib/storage/api"
import { UploadError } from "@/lib/domain/resume-upload/service"
import { createDiscoveryService } from "@/lib/domain/discovery/service"
import { after } from "next/server"
import { wakeDiscovery } from "@/lib/domain/discovery/wake"
export const runtime = "nodejs"
export const maxDuration = 60
const service = createDiscoveryService(db)
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  return uploadApi(request, (user) =>
    service.read(user, params.get("q") ?? "", params.get("state") ?? "new")
  )
}
export async function POST(request: Request) {
  return uploadApi(request, async (user) => {
    const reader = request.body?.getReader()
    if (!reader) throw new UploadError("invalid_input", 400)
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 20_000) throw new UploadError("invalid_input", 400)
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
    const { wake, ...result } = await service.mutate(user, input)
    if (wake) after(() => wakeDiscovery(wake))
    return result
  })
}
