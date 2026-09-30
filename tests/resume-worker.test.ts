import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createProcessingRuns } from "../lib/domain/processing-run/service"
import { validateResume } from "../lib/validation/resume"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createResumeWorker } from "../lib/domain/processing-run/resume-worker"
import type { UploadStorage } from "../lib/domain/resume-upload/service"
import { tinyPdf } from "./validation-fixtures"
nextEnv.loadEnvConfig(process.cwd())
const db = createDatabaseClient(process.env.DATABASE_URL!)
after(() => db.$disconnect())
test("worker resolves ownership through DB, validates, rejects, retries and recovers missing runs", async () => {
  const owner = `worker-domain-test-${randomUUID()}`,
    bytes = tinyPdf()
  await db.userProfile.create({ data: { id: owner } })
  let headCalls = 0,
    downloadCalls = 0,
    removeCalls = 0
  const storage: UploadStorage = {
    signPut: async () => "",
    signGet: async () => "",
    head: async () => {
      headCalls++
      return {
        size: bytes.length,
        contentType: "application/pdf",
        etag: "test",
      }
    },
    remove: async () => {
      removeCalls++
    },
  }
  try {
    const resume = await db.resume.create({
      data: { ownerUserId: owner, title: "Sanitized test" },
    })
    async function make(uploaded = false) {
      return db.resumeUpload.create({
        data: {
          ownerUserId: owner,
          resumeId: resume.id,
          // Deliberately unrelated path owner. Never parse identity from this key.
          objectKey: `users/forged-owner/${randomUUID()}.pdf`,
          originalFileName: "test.pdf",
          declaredContentType: "application/pdf",
          declaredSizeBytes: bytes.length,
          expiresAt: new Date(Date.now() + 60_000),
          ...(uploaded
            ? {
                status: "uploaded",
                actualContentType: "application/pdf",
                actualSizeBytes: BigInt(bytes.length),
                uploadedAt: new Date(),
              }
            : {}),
        },
      })
    }
    const upload = await make()
    const worker = createResumeWorker(db, storage, async (key, size) => {
      downloadCalls++
      assert.equal(key, upload.objectKey)
      assert.equal(size, BigInt(bytes.length))
      // A separate query sees and can mutate the committed claimed row during
      // external work. This would block if a claim transaction stayed open.
      const run = await db.processingRun.findFirstOrThrow({
        where: { resourceId: upload.id },
      })
      assert.equal(run.ownerUserId, owner)
      assert.equal(run.status, "running")
      await db.processingRun.update({
        where: { id: run.id },
        data: { checkpoint: { test: true } },
      })
      return bytes
    })
    assert.deepEqual(await worker.objectCreated("unknown"), {
      status: "ignored",
    })
    assert.equal(headCalls, 0)
    assert.equal(downloadCalls, 0)
    assert.deepEqual(await worker.objectCreated(upload.objectKey), {
      status: "succeeded",
    })
    assert.deepEqual(await worker.objectCreated(upload.objectKey), {
      status: "settled",
    })
    assert.equal(
      await db.processingRun.count({ where: { resourceId: upload.id } }),
      1
    )
    const valid = await db.resumeUpload.findUniqueOrThrow({
      where: { id: upload.id },
    })
    assert.equal(valid.detectedFormat, "pdf")
    assert.match(valid.contentSha256!, /^[0-9a-f]{64}$/)
    assert.ok(valid.validationCompletedAt)
    const invalid = await make()
    const rejectWorker = createResumeWorker(db, storage, async () =>
      Buffer.from("invalid")
    )
    assert.deepEqual(await rejectWorker.objectCreated(invalid.objectKey), {
      status: "failed",
    })
    const rejected = await db.resumeUpload.findUniqueOrThrow({
      where: { id: invalid.id },
    })
    assert.equal(rejected.status, "rejected")
    assert.equal(rejected.rejectionCode, "invalid_file_signature")
    assert.equal(rejected.contentSha256, null)
    assert.ok(rejected.validationCompletedAt)
    assert.ok(removeCalls)
    const transient = await make()
    const retryWorker = createResumeWorker(db, storage, async () => {
      throw new Error("private AWS detail")
    })
    assert.deepEqual(await retryWorker.objectCreated(transient.objectKey), {
      status: "retry_wait",
    })
    const retry = await db.processingRun.findFirstOrThrow({
      where: { resourceId: transient.id },
    })
    assert.equal(retry.errorCode, "dependency_unavailable")
    const canceled = await make()
    const cancelWorker = createResumeWorker(db, storage, async () => {
      await db.processingRun.updateMany({
        where: { resourceId: canceled.id },
        data: { cancellationRequestedAt: new Date() },
      })
      return bytes
    })
    assert.deepEqual(await cancelWorker.objectCreated(canceled.objectKey), {
      status: "canceled",
    })
    assert.equal(
      (
        await db.processingRun.findFirstOrThrow({
          where: { resourceId: canceled.id },
        })
      ).status,
      "canceled"
    )
    assert.equal(
      (await db.resumeUpload.findUniqueOrThrow({ where: { id: canceled.id } }))
        .validationCompletedAt,
      null
    )
    const missed = await make(true)
    // Mock only recovery discovery. Durable writes/claims remain real Postgres,
    // restricted to this fixture even when the shared branch has other uploads.
    const realRuns = createProcessingRuns(db)
    let recoveredRunId: string | null = null
    const scopedDb = new Proxy(db, {
      get(target, property) {
        if (property === "resumeUpload")
          return {
            ...target.resumeUpload,
            findMany: async () => [],
          }
        if (property === "$queryRaw") return async () => [missed]
        return Reflect.get(target, property)
      },
    })
    const recovery = createResumeWorker(
      scopedDb,
      storage,
      async () => bytes,
      validateResume,
      {
        ...realRuns,
        ensure: async (upload) => {
          assert.equal(upload.id, missed.id)
          const run = await realRuns.ensure(upload)
          recoveredRunId = run.id
          return run
        },
        claim: async (kind) =>
          recoveredRunId ? realRuns.claim(kind, recoveredRunId) : null,
      }
    )
    const counts = await recovery.recover()
    assert.ok(counts.ensured >= 1)
    assert.equal(
      (await db.resumeUpload.findUniqueOrThrow({ where: { id: missed.id } }))
        .detectedFormat,
      "pdf"
    )
  } finally {
    await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
    await db.resumeUpload.deleteMany({ where: { ownerUserId: owner } })
    await db.resume.deleteMany({ where: { ownerUserId: owner } })
    await db.userProfile.delete({ where: { id: owner } })
  }
})
