import type { PrismaClient } from "../../generated/prisma/client"
import { UploadError, type UploadRepository } from "./service"

export function createUploadRepository(db: PrismaClient): UploadRepository {
  return {
    createPending: (upload, title, existingResume) =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${upload.ownerUserId} FOR NO KEY UPDATE`
        if (existingResume) {
          const resume = await tx.resume.findFirst({
            where: { id: upload.resumeId, ownerUserId: upload.ownerUserId },
            select: { id: true },
          })
          if (!resume) throw new UploadError("resume_not_found", 404)
        } else {
          await tx.resume.create({
            data: {
              id: upload.resumeId,
              ownerUserId: upload.ownerUserId,
              title,
            },
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
}
