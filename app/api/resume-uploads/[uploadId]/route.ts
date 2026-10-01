import { uploadApi } from "@/lib/storage/api"
import { resumeUploads } from "@/lib/storage/uploads"
import { db } from "@/lib/db"
import { readResumeStructureStatus } from "@/lib/domain/resume-structure/status"
export const runtime = "nodejs"
export async function GET(
  request: Request,
  context: { params: Promise<{ uploadId: string }> }
) {
  return uploadApi(request, async (user) => {
    const uploadId = (await context.params).uploadId
    const status = await resumeUploads.readStatus(user, uploadId)
    const structuring =
      status.validation.state === "valid"
        ? await readResumeStructureStatus(db, user.id, uploadId)
        : null
    return { ...status, structuring }
  })
}
