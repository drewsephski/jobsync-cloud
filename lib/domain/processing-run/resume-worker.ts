import type { PrismaClient, ResumeUpload } from "../../generated/prisma/client"
import { createUploadRepository } from "../resume-upload/repository"
import {
  createUploadService,
  UploadError,
  type UploadStorage,
} from "../resume-upload/service"
import {
  createProcessingRuns,
  LostLeaseError,
  RESUME_VALIDATION_KIND,
} from "./service"
import { validateResume } from "../../validation/resume"
import { FileValidationError } from "../../validation/errors"

export const RECOVERY_BATCH_SIZE = 5
export function createResumeWorker(
  db: PrismaClient,
  storage: UploadStorage,
  download: (key: string, size: bigint) => Promise<Buffer>,
  validate = validateResume,
  runs = createProcessingRuns(db)
) {
  const uploads = createUploadService(createUploadRepository(db), storage)
  async function process(runId: string | null = null) {
    const run = await runs.claim(RESUME_VALIDATION_KIND, runId)
    if (!run) return "not_claimed"
    const start = Date.now()
    let outcome = "retry_wait"
    try {
      if (await runs.checkCancellation(run)) {
        outcome = "canceled"
        return outcome
      }
      const upload = await db.resumeUpload.findFirst({
        where: { id: run.resourceId, ownerUserId: run.ownerUserId ?? "" },
      })
      if (!upload || upload.status !== "uploaded") {
        outcome = await runs.finish(run, "failed", "upload_unavailable")
        return outcome
      }
      if (upload.validationCompletedAt) {
        outcome = await runs.finish(
          run,
          upload.contentSha256 ? "succeeded" : "failed",
          upload.rejectionCode
        )
        return outcome
      }
      const bytes = await download(upload.objectKey, upload.actualSizeBytes!)
      if (await runs.checkCancellation(run)) {
        outcome = "canceled"
        return outcome
      }
      await runs.renew(run)
      const result = await validate(bytes, upload.declaredContentType)
      if (await runs.checkCancellation(run)) {
        outcome = "canceled"
        return outcome
      }
      outcome = await runs.finish(run, "succeeded", null, { upload, ...result })
    } catch (error) {
      if (error instanceof LostLeaseError) outcome = "lost_lease"
      else if (error instanceof FileValidationError) {
        const upload = await db.resumeUpload.findFirst({
          where: { id: run.resourceId, ownerUserId: run.ownerUserId ?? "" },
        })
        if (!upload) throw new Error("upload_unavailable")
        try {
          outcome = await runs.finish(run, "failed", error.code, { upload })
          // Only the lease-authorized winner can delete a rejected object.
          const settled = await db.resumeUpload.findUnique({
            where: { id: upload.id },
          })
          if (settled?.status === "rejected")
            await storage.remove(upload.objectKey).catch(() => undefined)
        } catch (failure) {
          if (!(failure instanceof LostLeaseError)) throw failure
          outcome = "lost_lease"
        }
      } else {
        try {
          outcome = await runs.retry(run, "dependency_unavailable")
        } catch (failure) {
          if (!(failure instanceof LostLeaseError)) throw failure
          outcome = "lost_lease"
        }
      }
    } finally {
      console.info(
        JSON.stringify({
          runId: run.id,
          uploadId: run.resourceId,
          kind: run.kind,
          attempt: run.attempt,
          status: outcome,
          durationMs: Date.now() - start,
        })
      )
    }
    return outcome
  }
  async function reconcile(upload: ResumeUpload) {
    try {
      await uploads.reconcileStoredResumeUpload(upload.objectKey)
      const settled = await db.resumeUpload.findUniqueOrThrow({
        where: { id: upload.id },
      })
      if (settled.status === "uploaded" && !settled.validationCompletedAt)
        return runs.ensure(settled)
    } catch (error) {
      if (!(error instanceof UploadError) || error.status === 503) throw error
    }
    return null
  }
  return {
    async objectCreated(key: string) {
      const upload = await db.resumeUpload.findUnique({
        where: { objectKey: key },
      })
      if (!upload) return { status: "ignored" }
      const run = await reconcile(upload)
      return { status: run ? await process(run.id) : "settled" }
    },
    async recover() {
      const counts = { reconciled: 0, ensured: 0, processed: 0, errors: 0 }
      const pending = await db.resumeUpload.findMany({
        where: {
          status: "pending",
          createdAt: { lte: new Date(Date.now() - 30_000) },
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: RECOVERY_BATCH_SIZE,
      })
      for (const upload of pending) {
        try {
          await reconcile(upload)
          counts.reconciled++
        } catch {
          counts.errors++
        }
      }
      // Only missing runs: terminal failures must not starve later uploads.
      const missing = await db.$queryRaw<ResumeUpload[]>`
        SELECT u.* FROM "ResumeUpload" u WHERE u."status" = 'uploaded' AND u."validationCompletedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "ProcessingRun" r WHERE r."idempotencyKey" =
            'user:' || u."ownerUserId" || ':resume-validate:v1:' || u."id"::text)
        ORDER BY u."createdAt", u."id" LIMIT ${RECOVERY_BATCH_SIZE}
      `
      for (const upload of missing) {
        try {
          await runs.ensure(upload)
          counts.ensured++
        } catch {
          counts.errors++
        }
      }
      for (let i = 0; i < RECOVERY_BATCH_SIZE; i++) {
        try {
          if ((await process()) === "not_claimed") break
          counts.processed++
        } catch {
          counts.errors++
        }
      }
      // Retry best-effort invalid/abandoned-object cleanup on scheduled wakes.
      const rejected = await db.resumeUpload.findMany({
        where: { status: { in: ["rejected", "expired"] } },
        orderBy: { updatedAt: "asc" },
        take: RECOVERY_BATCH_SIZE,
      })
      for (const upload of rejected) {
        await storage.remove(upload.objectKey).catch(() => {
          counts.errors++
        })
        await db.resumeUpload.update({
          where: { id: upload.id },
          data: { updatedAt: new Date() },
        })
      }
      return counts
    },
  }
}
