import type { CurrentAuthUser } from "../../auth/session-context"
import type { Prisma, PrismaClient } from "../../generated/prisma/client"
import { UploadError } from "../resume-upload/service"
import {
  confirmSchema,
  editableContent,
  editSchema,
  preferencesSchema,
} from "./schema"

type Transaction = Prisma.TransactionClient
export type OnboardingState = Awaited<
  ReturnType<ReturnType<typeof createOnboardingService>["read"]>
>

export function createOnboardingService(db: PrismaClient) {
  async function snapshot(tx: Transaction, ownerUserId: string) {
    const profile = await tx.userProfile.findUniqueOrThrow({
      where: { id: ownerUserId },
    })
    const upload = await tx.resumeUpload.findFirst({
      where: { ownerUserId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { resume: true },
    })
    const versions = upload
      ? await tx.resumeVersion.findMany({
          where: { ownerUserId, resumeId: upload.resumeId },
          orderBy: { version: "desc" },
          take: 50,
          select: { id: true, version: true, source: true, createdAt: true },
        })
      : []
    const original = upload
      ? await tx.resumeVersion.findFirst({
          where: { ownerUserId, sourceUploadId: upload.id },
        })
      : null
    // Select this upload's lineage even if an older upload finishes out of order.
    const current = original
      ? await tx.resumeVersion.findFirst({
          where: {
            ownerUserId,
            resumeId: original.resumeId,
            OR: [{ id: original.id }, { originDraftId: original.id }],
          },
          orderBy: { version: "desc" },
        })
      : null
    const confirmed =
      !!current && upload?.resume.confirmedVersionId === current.id
    const targets = await tx.targetPreference.findMany({
      where: { ownerUserId, active: true },
      orderBy: [{ targetTitle: "asc" }, { id: "asc" }],
    })
    const step = profile.onboardingCompletedAt
      ? "complete"
      : confirmed
        ? "preferences"
        : current
          ? "review"
          : upload
            ? "processing"
            : "upload"
    return {
      step,
      completedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
      preferenceRevision: profile.preferenceRevision,
      upload: upload
        ? {
            id: upload.id,
            fileName: upload.originalFileName,
            status: upload.status,
          }
        : null,
      version: current
        ? {
            id: current.id,
            resumeId: current.resumeId,
            version: current.version,
            data: editableContent(current.data),
            confirmed,
            confirmedAt: confirmed
              ? upload!.resume.confirmedAt!.toISOString()
              : null,
          }
        : null,
      original: original
        ? {
            id: original.id,
            data: original.data,
            sha256: original.sourceSha256,
            promptVersion: original.promptVersion,
            schemaVersion: original.schemaVersion,
            extractionVersion: original.extractionVersion,
          }
        : null,
      history: versions.map((version) => ({
        id: version.id,
        version: version.version,
        source: version.source,
        createdAt: version.createdAt.toISOString(),
        confirmed: version.id === upload?.resume.confirmedVersionId,
      })),
      targets: targets.map((target) => ({
        targetTitle: target.targetTitle,
        location: target.location,
        remotePreferred: target.remotePreferred,
        minimumCompensationUsd:
          target.minimumCompensationUsd === null
            ? null
            : Number(target.minimumCompensationUsd),
        keywords: target.keywords,
      })),
    }
  }
  async function lockProfile(tx: Transaction, user: CurrentAuthUser) {
    // Serialize owner mutations without blocking the worker's foreign-key KEY SHARE.
    // FOR UPDATE here would invert the worker Resume -> profile FK lock order.
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "UserProfile" WHERE id = ${user.id} FOR NO KEY UPDATE`
    if (!rows.length) throw new UploadError("profile_not_found", 404)
  }
  async function lockCurrent(
    tx: Transaction,
    user: CurrentAuthUser,
    expectedVersionId: string
  ) {
    await lockProfile(tx, user)
    const owned = await tx.resumeVersion.findFirst({
      where: { id: expectedVersionId, ownerUserId: user.id },
      select: { resumeId: true },
    })
    if (!owned) throw new UploadError("resume_not_found", 404)
    // Same lock order as upload creation; same Resume lock as AI version allocation.
    await tx.$queryRaw`SELECT id FROM "Resume" WHERE id = ${owned.resumeId}::uuid AND "ownerUserId" = ${user.id} FOR UPDATE`
    const state = await snapshot(tx, user.id)
    if (state.version?.id !== expectedVersionId)
      throw new UploadError("version_conflict", 409)
    return state
  }
  function parse<T>(
    result: { success: true; data: T } | { success: false }
  ): T {
    if (!result.success) throw new UploadError("invalid_input", 400)
    return result.data
  }
  return {
    read: (user: CurrentAuthUser) =>
      db.$transaction((tx) => snapshot(tx, user.id), {
        isolationLevel: "RepeatableRead",
      }),
    save: (user: CurrentAuthUser, input: unknown) => {
      const { expectedVersionId, data } = parse(editSchema.safeParse(input))
      return db.$transaction(async (tx) => {
        const state = await lockCurrent(tx, user, expectedVersionId)
        if (JSON.stringify(state.version!.data) !== JSON.stringify(data)) {
          const last = await tx.resumeVersion.aggregate({
            where: { ownerUserId: user.id, resumeId: state.version!.resumeId },
            _max: { version: true },
          })
          await tx.resumeVersion.create({
            data: {
              ownerUserId: user.id,
              resumeId: state.version!.resumeId,
              version: (last._max.version ?? 0) + 1,
              source: "manual",
              status: "draft",
              originDraftId: state.original!.id,
              data: data as Prisma.InputJsonValue,
            },
          })
        }
        return snapshot(tx, user.id)
      })
    },
    confirm: (user: CurrentAuthUser, input: unknown) => {
      const { expectedVersionId } = parse(confirmSchema.safeParse(input))
      return db.$transaction(async (tx) => {
        const state = await lockCurrent(tx, user, expectedVersionId)
        const version = state.version!
        if (
          !version.data.contact.name?.trim() ||
          !(
            version.data.summary?.trim() ||
            version.data.skills.some((skill) => skill.trim()) ||
            version.data.employment.some(
              (entry) => entry.employer?.trim() || entry.title?.trim()
            ) ||
            version.data.education.some(
              (entry) =>
                entry.institution?.trim() || entry.qualification?.trim()
            ) ||
            version.data.credentials.some((entry) => entry.name?.trim())
          )
        )
          throw new UploadError("resume_incomplete", 400)
        if (!version.confirmed)
          await tx.resume.updateMany({
            where: { id: version.resumeId, ownerUserId: user.id },
            data: { confirmedVersionId: version.id, confirmedAt: new Date() },
          })
        return snapshot(tx, user.id)
      })
    },
    preferences: (user: CurrentAuthUser, input: unknown) => {
      const { expectedVersionId, expectedRevision, targets, complete } = parse(
        preferencesSchema.safeParse(input)
      )
      return db.$transaction(async (tx) => {
        const state = await lockCurrent(tx, user, expectedVersionId)
        if (!state.version!.confirmed)
          throw new UploadError("resume_not_confirmed", 409)
        // A repeated finish never rewrites preferences or the completion instant.
        if (state.completedAt && complete) return state
        if (state.completedAt) throw new UploadError("onboarding_complete", 409)
        if (state.preferenceRevision !== expectedRevision)
          throw new UploadError("preferences_conflict", 409)
        await tx.targetPreference.deleteMany({
          where: { ownerUserId: user.id, active: true },
        })
        await tx.targetPreference.createMany({
          data: targets.map((target) => ({
            ...target,
            ownerUserId: user.id,
            minimumCompensationUsd:
              target.minimumCompensationUsd === null
                ? null
                : BigInt(target.minimumCompensationUsd),
          })),
        })
        await tx.userProfile.update({
          where: { id: user.id },
          data: {
            preferenceRevision: { increment: 1 },
            ...(complete ? { onboardingCompletedAt: new Date() } : {}),
          },
        })
        return snapshot(tx, user.id)
      })
    },
  }
}
