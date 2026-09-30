import "server-only"
import { db } from "@/lib/db"
import {
  createUploadService,
  UploadError,
  type UploadRepository,
} from "@/lib/storage/upload-service"
import { s3Transport } from "@/lib/storage/s3-transport"

export const uploadRepository: UploadRepository = {
  createPending: (upload, title, existingResume) =>
    db.$transaction(async (tx) => {
      if (existingResume) {
        const resume = await tx.resume.findFirst({
          where: { id: upload.resumeId, ownerUserId: upload.ownerUserId },
          select: { id: true },
        })
        if (!resume) throw new UploadError("resume_not_found", 404)
      } else {
        await tx.resume.create({
          data: { id: upload.resumeId, ownerUserId: upload.ownerUserId, title },
        })
      }
      return tx.resumeUpload.create({ data: upload })
    }),
  findOwned: (id, ownerUserId) =>
    db.resumeUpload.findFirst({ where: { id, ownerUserId } }),
  findByObjectKey: (objectKey) =>
    db.resumeUpload.findUnique({ where: { objectKey } }),
  settlePending: (id, data) =>
    db.$transaction(async (tx) => {
      await tx.resumeUpload.updateMany({
        where: { id, status: "pending" },
        data,
      })
      return tx.resumeUpload.findUniqueOrThrow({ where: { id } })
    }),
}
export const resumeUploads = createUploadService(uploadRepository, s3Transport)
