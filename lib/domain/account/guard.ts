import type { Prisma } from "../../generated/prisma/client"
import { UploadError } from "../resume-upload/service"

export async function requireActiveAccount(
  tx: Prisma.TransactionClient,
  owner: string
) {
  const profile = await tx.userProfile.findUnique({ where: { id: owner } })
  if (!profile || profile.deletionRequestedAt)
    throw new UploadError("account_deleting", 403)
  return profile
}
