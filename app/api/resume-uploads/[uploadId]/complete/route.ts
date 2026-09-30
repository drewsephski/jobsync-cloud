import { uploadApi } from "@/lib/storage/api"
import { resumeUploads } from "@/lib/storage/uploads"

export const runtime = "nodejs"
export async function POST(
  request: Request,
  context: { params: Promise<{ uploadId: string }> }
) {
  return uploadApi(request, async (user) =>
    resumeUploads.reconcileResumeUpload(user, (await context.params).uploadId)
  )
}
