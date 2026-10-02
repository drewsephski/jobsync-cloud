import { db } from "@/lib/db"
import { uploadApi } from "@/lib/storage/api"
import { createMcpTokenService } from "@/lib/mcp/tokens"
import { UploadError } from "@/lib/domain/resume-upload/service"
export const runtime = "nodejs"
const service = createMcpTokenService(db)
async function input(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new UploadError("invalid_input", 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4000) throw new UploadError("invalid_input", 400)
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new UploadError("invalid_input", 400)
  }
}
export async function GET(request: Request) {
  return uploadApi(request, async (user) => ({
    tokens: await service.list(user),
  }))
}
export async function POST(request: Request) {
  return uploadApi(
    request,
    async (user) => service.create(user, await input(request)),
    201
  )
}
export async function DELETE(request: Request) {
  return uploadApi(request, async (user) =>
    service.revoke(user, await input(request))
  )
}
