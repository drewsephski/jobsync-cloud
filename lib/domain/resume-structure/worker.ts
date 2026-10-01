import { randomUUID } from "node:crypto"
import type {
  Prisma,
  PrismaClient,
  ProcessingRun,
  ResumeUpload,
} from "../../generated/prisma/client"
import { createProcessingRuns, LostLeaseError } from "../processing-run/service"
import {
  createAiAccounting,
  AllowanceError,
  lockLiveRun,
  receiptData,
} from "./accounting"
import type {
  AiReceipt,
  ResumeStructurer,
  StructureResult,
} from "../../ai/openrouter"
import { extractResumeText, EXTRACTION_VERSION } from "../../validation/extract"
import { FileValidationError } from "../../validation/errors"
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  validateGroundedResume,
} from "../../ai/resume-schema"
export const RESUME_STRUCTURE_KIND = "resume_structure_v1"
export const structureKey = (
  upload: Pick<ResumeUpload, "ownerUserId" | "id">
) => `user:${upload.ownerUserId}:resume-structure:v1:${upload.id}`
export function createResumeStructureWorker(
  db: PrismaClient,
  download: (key: string, size: bigint) => Promise<Buffer>,
  structure: ResumeStructurer,
  reconcileReceipt?: (id: string) => Promise<AiReceipt | null>,
  extract = extractResumeText
) {
  const runs = createProcessingRuns(db)
  const accounting = createAiAccounting(db)
  async function ensure(upload: ResumeUpload) {
    if (
      upload.status !== "uploaded" ||
      !upload.contentSha256 ||
      !upload.detectedFormat ||
      !upload.validationCompletedAt
    )
      return null
    const rows = await db.$queryRaw<
      ProcessingRun[]
    >`INSERT INTO "ProcessingRun" (id,"ownerUserId",kind,"resourceId","idempotencyKey","updatedAt")
      VALUES (${randomUUID()}::uuid,${upload.ownerUserId},${RESUME_STRUCTURE_KIND},${upload.id},${structureKey(upload)},now())
      ON CONFLICT ("idempotencyKey") DO UPDATE SET "idempotencyKey" = EXCLUDED."idempotencyKey"
      WHERE "ProcessingRun"."ownerUserId" = EXCLUDED."ownerUserId" AND "ProcessingRun"."kind" = EXCLUDED."kind" AND "ProcessingRun"."resourceId" = EXCLUDED."resourceId" RETURNING *`
    if (!rows[0]) throw new Error("idempotency_conflict")
    return rows[0]
  }
  async function process(id: string | null = null) {
    const run = await runs.claim(RESUME_STRUCTURE_KIND, id)
    if (!run) return "not_claimed"
    const start = Date.now()
    let outcome = "failed"
    let requestId: string | null = null
    let result: StructureResult | null = null
    try {
      if (await runs.checkCancellation(run)) return (outcome = "canceled")
      const upload = await db.resumeUpload.findFirst({
        where: {
          id: run.resourceId,
          ownerUserId: run.ownerUserId!,
          status: "uploaded",
        },
      })
      if (
        !upload?.contentSha256 ||
        !upload.detectedFormat ||
        !upload.validationCompletedAt
      )
        return (outcome = await runs.finish(
          run,
          "failed",
          "source_not_validated"
        ))
      const draft = await db.resumeVersion.findUnique({
        where: { sourceUploadId: upload.id },
      })
      if (draft) return (outcome = await runs.finish(run, "succeeded", null))
      // Before reading source or dispatching, detect a previous uncertain/paid call.
      const previous = await db.aiUsageReservation.findUnique({
        where: { idempotencyKey: run.idempotencyKey },
        include: { usage: true },
      })
      if (
        previous?.usage.some(
          (row) => row.status !== "failed" || row.costMicroUsd !== BigInt(0)
        )
      )
        return (outcome = await runs.finish(
          run,
          "failed",
          previous.usage.some((row) => row.costMicroUsd === null)
            ? "provider_outcome_unknown"
            : "draft_commit_interrupted"
        ))
      const bytes = await download(upload.objectKey, upload.actualSizeBytes!)
      const text = await extract(
        bytes,
        upload.detectedFormat,
        upload.contentSha256
      )
      if (await runs.checkCancellation(run)) return (outcome = "canceled")
      await runs.renew(run)
      const reservation = await accounting.reserve(run)
      await runs.renew(run)
      const usage = await accounting.begin(run, reservation.id)
      requestId = usage.requestId
      result = await structure(text, (receipt) =>
        accounting.capture(requestId!, receipt)
      )
      // Defense in depth: injected adapters/test doubles cannot bypass acceptance.
      if (result.data) {
        try {
          result.data = validateGroundedResume(result.data, text)
        } catch {
          result = {
            ...result,
            data: null,
            errorCode: "invalid_model_output",
            retryable: false,
          }
        }
      }
      await db.$transaction(async (tx) => {
        await lockLiveRun(tx, run)
        await accounting.record(tx, requestId!, result!)
        if (result!.data) {
          // Serialize semantic version allocation per Resume, across distinct uploads.
          await tx.$queryRaw`SELECT id FROM "Resume" WHERE id = ${upload.resumeId}::uuid AND "ownerUserId" = ${upload.ownerUserId} FOR UPDATE`
          const last = await tx.resumeVersion.aggregate({
            where: { resumeId: upload.resumeId },
            _max: { version: true },
          })
          await tx.resumeVersion.create({
            data: {
              ownerUserId: upload.ownerUserId,
              resumeId: upload.resumeId,
              version: (last._max.version ?? 0) + 1,
              source: "upload",
              status: "draft",
              sourceUploadId: upload.id,
              processingRunId: run.id,
              sourceSha256: upload.contentSha256,
              extractionVersion: EXTRACTION_VERSION,
              promptVersion: PROMPT_VERSION,
              schemaVersion: SCHEMA_VERSION,
              data: result!.data as Prisma.InputJsonValue,
            },
          })
        }
        // These share the transaction: a draft cannot exist without its terminal run.
        await tx.processingRun.update({
          where: { id: run.id },
          data: {
            status: result!.data
              ? "succeeded"
              : result!.retryable && run.attempt < 2
                ? "retry_wait"
                : "failed",
            errorCode: result!.errorCode,
            leaseToken: null,
            leaseExpiresAt: null,
            availableAt: new Date(Date.now() + 30_000),
            completedAt:
              result!.retryable && run.attempt < 2 ? null : new Date(),
          },
        })
        if (result!.retryable && run.attempt >= 2)
          await accounting.settleIn(tx, reservation.id)
      })
      outcome = result.data
        ? "succeeded"
        : result.retryable && run.attempt < 2
          ? "retry_wait"
          : "failed"
    } catch (error) {
      // Receipts are provider evidence, not a lease-authorized product mutation.
      // Keep accounting even if canceled/fenced out. Never create a stale draft.
      if (requestId && result)
        await db.$transaction((tx) =>
          accounting.record(tx, requestId!, result!)
        )
      const code =
        error instanceof FileValidationError
          ? error.code
          : error instanceof AllowanceError
            ? error.code
            : requestId
              ? "provider_outcome_unknown"
              : "dependency_unavailable"
      try {
        outcome =
          error instanceof LostLeaseError
            ? (await runs.checkCancellation(run))
              ? "canceled"
              : "lost_lease"
            : requestId ||
                error instanceof FileValidationError ||
                error instanceof AllowanceError
              ? await runs.finish(run, "failed", code)
              : await runs.retry(run, code)
      } catch (failure) {
        if (!(failure instanceof LostLeaseError)) throw failure
        outcome = "lost_lease"
      }
    } finally {
      console.info(
        JSON.stringify({
          runId: run.id,
          kind: run.kind,
          attempt: run.attempt,
          status: outcome,
          durationMs: Date.now() - start,
        })
      )
    }
    return outcome
  }
  async function recover() {
    const uploads = await db.$queryRaw<
      ResumeUpload[]
    >`SELECT u.* FROM "ResumeUpload" u WHERE u.status = 'uploaded' AND u."contentSha256" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "ProcessingRun" r WHERE r."idempotencyKey" = 'user:' || u."ownerUserId" || ':resume-structure:v1:' || u.id::text)
      ORDER BY u."createdAt",u.id LIMIT 5`
    for (const upload of uploads) await ensure(upload)
    let processed = 0
    for (let i = 0; i < 5; i++) {
      if ((await process()) === "not_claimed") break
      processed++
    }
    let reconciled = 0
    if (reconcileReceipt) {
      const unknown = await db.aiUsage.findMany({
        where: {
          status: "reconciliation_required",
          providerRequestId: { not: null },
        },
        orderBy: { updatedAt: "asc" },
        take: 5,
      })
      for (const usage of unknown) {
        const receipt = await reconcileReceipt(usage.providerRequestId!)
        if (receipt?.costMicroUsd !== null && receipt) {
          await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "AiUsageReservation" WHERE id = ${usage.reservationId}::uuid FOR UPDATE`
            const current = await tx.aiUsage.findUniqueOrThrow({
              where: { id: usage.id },
            })
            if (current.status !== "reconciliation_required") return
            await tx.aiUsage.update({
              where: { id: usage.id },
              data: {
                ...receiptData(receipt),
                status: current.errorCode ? "failed" : "succeeded",
              },
            })
            await accounting.settleIn(tx, usage.reservationId!)
          })
          reconciled++
        } else
          await db.aiUsage.update({
            where: { id: usage.id },
            data: { updatedAt: new Date() },
          })
      }
    }
    // Reservations with no dispatch are safe to release only after terminal work.
    const unused = await db.$queryRaw<
      { id: string }[]
    >`SELECT a.id FROM "AiUsageReservation" a JOIN "ProcessingRun" r ON r."idempotencyKey" = a."idempotencyKey"
      WHERE a.status = 'reserved' AND r.status IN ('failed','canceled') AND NOT EXISTS (SELECT 1 FROM "AiUsage" u WHERE u."reservationId" = a.id AND (u.status <> 'failed' OR u."costMicroUsd" IS NULL OR u."costMicroUsd" <> 0)) LIMIT 5`
    for (const reservation of unused)
      await db.$transaction((tx) => accounting.settleIn(tx, reservation.id))
    return { ensured: uploads.length, processed, reconciled }
  }
  return {
    ensure,
    process,
    recover,
    async uploaded(upload: ResumeUpload) {
      const run = await ensure(upload)
      return run ? process(run.id) : "not_validated"
    },
  }
}
