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
    const validationRun =
      status.validation.state === "pending"
        ? await db.processingRun.findFirst({
            where: {
              ownerUserId: user.id,
              resourceId: uploadId,
              kind: "resume_validate_v1",
              status: { in: ["failed", "canceled"] },
            },
            select: { status: true },
          })
        : null
    return {
      ...status,
      structuring,
      processingFailure: validationRun
        ? "We couldn’t finish checking this file. Your upload record is saved. Try uploading a new text-based PDF or DOCX."
        : null,
    }
  })
}
