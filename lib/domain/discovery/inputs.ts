import type { Prisma } from "../../generated/prisma/client"
import { editableContent } from "../onboarding/schema"
import { preferenceFingerprint } from "./relevance"
export async function profileInputs(
  tx: Prisma.TransactionClient,
  ownerUserId: string
) {
  const profile = await tx.userProfile.findUnique({
    where: { id: ownerUserId },
  })
  const resume = await tx.resume.findFirst({
    where: {
      ownerUserId,
      confirmedVersionId: { not: null },
      confirmedAt: { not: null },
    },
    orderBy: [{ confirmedAt: "desc" }, { id: "asc" }],
    include: { confirmedVersion: true },
  })
  const targets = await tx.targetPreference.findMany({
    where: { ownerUserId, active: true },
    orderBy: { id: "asc" },
  })
  if (
    !profile?.onboardingCompletedAt ||
    profile.deletionRequestedAt ||
    !resume?.confirmedVersion ||
    !targets.length
  )
    return null
  return {
    profile,
    resume,
    version: resume.confirmedVersion,
    content: editableContent(resume.confirmedVersion.data),
    targets,
    preferenceHash: preferenceFingerprint(targets),
  }
}
