import { randomUUID } from "node:crypto"
import type {
  Prisma,
  PrismaClient,
  ProcessingRun,
  ResumeUpload,
} from "../../generated/prisma/client"

export const RESUME_VALIDATION_KIND = "resume_validate_v1"
export const LEASE_SECONDS = 120
export const MAX_ATTEMPTS = 5
export const GLOBAL_CONCURRENCY = 5
export const OWNER_CONCURRENCY = 2
export class LostLeaseError extends Error {
  constructor() {
    super("lost_lease")
  }
}
export function validationIdempotencyKey(
  upload: Pick<ResumeUpload, "ownerUserId" | "id">
) {
  return `user:${upload.ownerUserId}:resume-validate:v1:${upload.id}`
}
export function retryDelaySeconds(attempt: number, random = Math.random) {
  return (
    Math.min(900, 30 * 2 ** Math.max(0, attempt - 1)) * (0.75 + random() * 0.5)
  )
}

export function createProcessingRuns(db: PrismaClient, random = Math.random) {
  async function ensure(upload: ResumeUpload) {
    const rows = await db.$queryRaw<ProcessingRun[]>`
      INSERT INTO "ProcessingRun" ("id", "ownerUserId", "kind", "resourceId", "idempotencyKey", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${upload.ownerUserId}, ${RESUME_VALIDATION_KIND}, ${upload.id}, ${validationIdempotencyKey(upload)}, now())
      ON CONFLICT ("idempotencyKey") DO UPDATE SET "idempotencyKey" = EXCLUDED."idempotencyKey"
      WHERE "ProcessingRun"."ownerUserId" = EXCLUDED."ownerUserId"
        AND "ProcessingRun"."kind" = EXCLUDED."kind"
        AND "ProcessingRun"."resourceId" = EXCLUDED."resourceId"
      RETURNING *
    `
    if (!rows[0]) throw new Error("idempotency_conflict")
    return rows[0]
  }
  async function claim(
    kind: string,
    runId: string | null = null
  ): Promise<ProcessingRun | null> {
    return db.$transaction(async (tx) => {
      // Serialize only the short claim phase so concurrency budgets are atomic.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234101)`
      await tx.$executeRaw`
        WITH exhausted AS (
          SELECT "id" FROM "ProcessingRun"
          WHERE "kind" = ${kind} AND (${runId}::uuid IS NULL OR "id" = ${runId}::uuid)
            AND (("status" IN ('pending', 'retry_wait') AND "availableAt" <= now())
              OR ("status" = 'running' AND "leaseExpiresAt" <= now()))
            AND ("attempt" >= ${MAX_ATTEMPTS} OR "cancellationRequestedAt" IS NOT NULL)
          ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 5
        )
        UPDATE "ProcessingRun" SET "status" = CASE WHEN "cancellationRequestedAt" IS NOT NULL
          THEN 'canceled'::"ProcessingRunStatus" ELSE 'failed'::"ProcessingRunStatus" END,
          "leaseToken" = NULL, "leaseExpiresAt" = NULL, "completedAt" = now(), "updatedAt" = now(),
          "errorCode" = CASE WHEN "cancellationRequestedAt" IS NOT NULL THEN NULL ELSE 'attempts_exhausted' END
        WHERE "id" IN (SELECT "id" FROM exhausted)
      `
      const rows = await tx.$queryRaw<ProcessingRun[]>`
        WITH candidate AS (
          SELECT r."id" FROM "ProcessingRun" r
          WHERE r."kind" = ${kind} AND (${runId}::uuid IS NULL OR r."id" = ${runId}::uuid)
            AND r."attempt" < ${MAX_ATTEMPTS}
            AND ((r."status" IN ('pending', 'retry_wait') AND r."availableAt" <= now())
              OR (r."status" = 'running' AND r."leaseExpiresAt" <= now()))
            AND (SELECT count(*) FROM "ProcessingRun" WHERE "status" = 'running' AND "leaseExpiresAt" > clock_timestamp()) < ${GLOBAL_CONCURRENCY}
            AND (SELECT count(*) FROM "ProcessingRun" active WHERE active."status" = 'running'
              AND active."leaseExpiresAt" > clock_timestamp() AND active."ownerUserId" IS NOT DISTINCT FROM r."ownerUserId") < ${OWNER_CONCURRENCY}
          ORDER BY r."availableAt", r."id"
          FOR UPDATE OF r SKIP LOCKED LIMIT 1
        )
        UPDATE "ProcessingRun" r SET "status" = 'running', "attempt" = r."attempt" + 1,
          "leaseToken" = ${randomUUID()}::uuid, "leaseExpiresAt" = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
          "startedAt" = COALESCE(r."startedAt", now()), "completedAt" = NULL, "errorCode" = NULL, "updatedAt" = now()
        FROM candidate WHERE r."id" = candidate."id" RETURNING r.*
      `
      return rows[0] ?? null
    })
  }
  async function renew(run: ProcessingRun) {
    const rows = await db.$queryRaw<ProcessingRun[]>`
      UPDATE "ProcessingRun" SET "leaseExpiresAt" = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second', "updatedAt" = now()
      WHERE "id" = ${run.id}::uuid AND "leaseToken" = ${run.leaseToken}::uuid
        AND "status" = 'running' AND "leaseExpiresAt" > clock_timestamp() RETURNING *
    `
    if (!rows[0]) throw new LostLeaseError()
    return rows[0]
  }
  async function checkCancellation(run: ProcessingRun) {
    const rows = await db.$queryRaw<ProcessingRun[]>`
      SELECT * FROM "ProcessingRun" WHERE "id" = ${run.id}::uuid AND "leaseToken" = ${run.leaseToken}::uuid
        AND "status" = 'running' AND "leaseExpiresAt" > clock_timestamp()
    `
    if (!rows[0]) throw new LostLeaseError()
    if (!rows[0].cancellationRequestedAt) return false
    await finish(run, "canceled", null)
    return true
  }
  async function finish(
    run: ProcessingRun,
    status: "succeeded" | "failed" | "canceled",
    code: string | null,
    validation?: {
      upload: ResumeUpload
      format?: "pdf" | "docx"
      hash?: string
    }
  ) {
    return db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ProcessingRun[]>`
        UPDATE "ProcessingRun" SET "status" = CASE WHEN "cancellationRequestedAt" IS NOT NULL
            THEN 'canceled'::"ProcessingRunStatus" ELSE ${status}::"ProcessingRunStatus" END,
          "leaseToken" = NULL, "leaseExpiresAt" = NULL, "completedAt" = now(), "updatedAt" = now(),
          "errorCode" = CASE WHEN "cancellationRequestedAt" IS NOT NULL THEN NULL ELSE ${code} END
        WHERE "id" = ${run.id}::uuid AND "leaseToken" = ${run.leaseToken}::uuid
          AND "status" = 'running' AND "leaseExpiresAt" > clock_timestamp() RETURNING *
      `
      if (!rows[0]) throw new LostLeaseError()
      if (validation && rows[0].status !== "canceled") {
        if (
          run.ownerUserId !== validation.upload.ownerUserId ||
          run.resourceId !== validation.upload.id ||
          run.kind !== RESUME_VALIDATION_KIND
        )
          throw new Error("invalid_run_resource")
        const updated = await tx.resumeUpload.updateMany({
          where: {
            id: validation.upload.id,
            ownerUserId: run.ownerUserId,
            status: "uploaded",
            validationCompletedAt: null,
          },
          data:
            status === "succeeded"
              ? {
                  validationCompletedAt: new Date(),
                  detectedFormat: validation.format!,
                  contentSha256: validation.hash!,
                }
              : {
                  status: "rejected",
                  rejectionCode: code,
                  validationCompletedAt: new Date(),
                },
        })
        if (updated.count !== 1) throw new Error("validation_state_conflict")
      }
      return rows[0].status
    })
  }
  async function retry(run: ProcessingRun, code: string) {
    const delay = retryDelaySeconds(run.attempt, random)
    const rows = await db.$queryRaw<ProcessingRun[]>`
      UPDATE "ProcessingRun" SET
        "status" = CASE WHEN "cancellationRequestedAt" IS NOT NULL THEN 'canceled'::"ProcessingRunStatus"
          WHEN "attempt" >= ${MAX_ATTEMPTS} THEN 'failed'::"ProcessingRunStatus" ELSE 'retry_wait'::"ProcessingRunStatus" END,
        "availableAt" = now() + ${delay} * interval '1 second',
        "completedAt" = CASE WHEN "attempt" >= ${MAX_ATTEMPTS} OR "cancellationRequestedAt" IS NOT NULL THEN now() ELSE NULL END,
        "errorCode" = CASE WHEN "cancellationRequestedAt" IS NOT NULL THEN NULL ELSE ${code} END,
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${run.id}::uuid AND "leaseToken" = ${run.leaseToken}::uuid
        AND "status" = 'running' AND "leaseExpiresAt" > clock_timestamp() RETURNING *
    `
    if (!rows[0]) throw new LostLeaseError()
    return rows[0].status
  }
  async function checkpoint(run: ProcessingRun, value: Prisma.InputJsonValue) {
    const count = await db.$executeRaw`
      UPDATE "ProcessingRun" SET "checkpoint" = ${JSON.stringify(value)}::jsonb, "updatedAt" = now()
      WHERE "id" = ${run.id}::uuid AND "leaseToken" = ${run.leaseToken}::uuid
        AND "status" = 'running' AND "leaseExpiresAt" > clock_timestamp()
    `
    if (count !== 1) throw new LostLeaseError()
  }
  return { ensure, claim, renew, checkCancellation, finish, retry, checkpoint }
}
