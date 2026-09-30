import { uploadApi } from "@/lib/storage/api"
import { resumeUploads } from "@/lib/storage/uploads"
export const runtime = "nodejs"
export async function GET(
  request: Request,
  context: { params: Promise<{ uploadId: string }> }
) {
  return uploadApi(request, async (user) =>
    resumeUploads.readStatus(user, (await context.params).uploadId)
  )
}
