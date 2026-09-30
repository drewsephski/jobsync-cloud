import { uploadApi } from "@/lib/storage/api"
import { resumeUploads } from "@/lib/storage/uploads"
import { UploadError } from "@/lib/storage/upload-service"

export const runtime = "nodejs"
export async function POST(request: Request) {
  return uploadApi(
    request,
    async (user) => {
      let input: unknown
      try {
        input = await request.json()
      } catch {
        throw new UploadError("invalid_upload", 400)
      }
      return resumeUploads.createResumeUploadIntent(user, input)
    },
    201
  )
}
