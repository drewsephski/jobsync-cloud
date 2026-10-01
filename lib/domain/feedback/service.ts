import type { PrismaClient } from "../../generated/prisma/client"
import { UploadError } from "../resume-upload/service"
import { requireActiveAccount } from "../account/guard"
import { feedbackSchema } from "./schema"

export function createFeedbackService(db: PrismaClient) {
  return {
    async submit(ownerUserId: string, input: unknown) {
      const parsed = feedbackSchema.safeParse(input)
      if (!parsed.success) throw new UploadError("invalid_input", 400)
      return db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT "id" FROM "UserProfile" WHERE "id"=${ownerUserId} FOR UPDATE`
          await requireActiveAccount(tx, ownerUserId)
          const where = {
            ownerUserId,
            submissionKey: parsed.data.submissionKey,
          }
          if (
            await tx.productFeedback.findUnique({
              where: { ownerUserId_submissionKey: where },
            })
          )
            return { received: true }
          const count = await tx.productFeedback.count({
            where: {
              ownerUserId,
              createdAt: { gte: new Date(Date.now() - 86_400_000) },
            },
          })
          if (count >= 5) throw new UploadError("feedback_limit", 429)
          await tx.productFeedback.create({
            data: { ownerUserId, ...parsed.data },
          })
          return { received: true }
        },
        { timeout: 30_000 }
      )
    },
  }
}
