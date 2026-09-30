import nextEnv from "@next/env"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createStorageClient } from "../lib/backend/create-storage-client"
import { createS3Transport } from "../lib/backend/s3-transport"
import { createUploadRepository } from "../lib/domain/resume-upload/repository"
import { createUploadService } from "../lib/domain/resume-upload/service"
import { createSessionContext } from "../lib/auth/session-context"
import {
  createProcessingRuns,
  LostLeaseError,
} from "../lib/domain/processing-run/service"
import { tinyPdf } from "../tests/validation-fixtures"
nextEnv.loadEnvConfig(process.cwd())
const env = process.env
assert.equal(
  env.JOBSYNC_WORKER_LIVE_BRANCH,
  "lively-shape-65452824/br-tiny-tree-b44fo1lv"
)
assert.ok(
  new URL(env.DATABASE_URL!).hostname.startsWith("ep-green-scene-b45djevq")
)
assert.ok(
  new URL(env.AWS_ENDPOINT_URL_S3!).hostname.startsWith(
    "br-tiny-tree-b44fo1lv."
  )
)
const db = createDatabaseClient(env.DATABASE_URL!)
const s3 = createStorageClient({
  endpoint: env.AWS_ENDPOINT_URL_S3!,
  region: env.AWS_REGION!,
  accessKeyId: env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
})
const storage = createS3Transport(s3),
  runs = createProcessingRuns(db)
const owner = `worker-schedule-proof-${randomUUID()}`,
  keys: string[] = []
await db.userProfile.create({ data: { id: owner } })
const user = await createSessionContext(
  async () => ({ data: { user: { id: owner } }, error: null }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
const uploads = createUploadService(createUploadRepository(db), storage)
try {
  const bytes = tinyPdf()
  const intent = await uploads.createResumeUploadIntent(user, {
    fileName: "sanitized.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.length,
  })
  const upload = await db.resumeUpload.findUniqueOrThrow({
    where: { id: intent.uploadId },
  })
  keys.push(upload.objectKey)
  assert.ok(
    (
      await fetch(intent.upload.url, {
        method: "PUT",
        headers: intent.upload.headers,
        body: bytes,
      })
    ).ok
  )
  const start = Date.now()
  let run
  while (Date.now() - start < 30_000) {
    run = await db.processingRun.findFirst({ where: { resourceId: upload.id } })
    if (run?.status === "succeeded") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(run?.status, "succeeded")
  const oldToken = randomUUID()
  // Only this dedicated fixture is reset. No founder/customer records touched.
  await db.$transaction(async (tx) => {
    await tx.resumeUpload.update({
      where: { id: upload.id },
      data: {
        validationCompletedAt: null,
        detectedFormat: null,
        contentSha256: null,
      },
    })
    await tx.processingRun.update({
      where: { id: run!.id },
      data: {
        status: "running",
        attempt: 1,
        leaseToken: oldToken,
        leaseExpiresAt: new Date(Date.now() - 10_000),
        completedAt: null,
      },
    })
  })
  const oldRun = await db.processingRun.findUniqueOrThrow({
    where: { id: run!.id },
  })
  console.log({
    check: "expired fixture awaits actual scheduled trigger",
    runId: run!.id,
    uploadId: upload.id,
  })
  const waitStart = Date.now()
  let replacementToken: string | null = null
  let staleRejected = false
  while (Date.now() - waitStart < 90_000) {
    const current = await db.processingRun.findUniqueOrThrow({
      where: { id: run!.id },
    })
    if (current.attempt >= 2 && !staleRejected) {
      if (current.leaseToken && current.leaseToken !== oldToken)
        replacementToken = current.leaseToken
      await assert.rejects(
        runs.finish(oldRun, "succeeded", null),
        LostLeaseError
      )
      staleRejected = true
    }
    if (current.status === "succeeded" && current.attempt >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const completed = await db.processingRun.findUniqueOrThrow({
    where: { id: run!.id },
  })
  assert.equal(completed.status, "succeeded")
  assert.equal(completed.attempt, 2)
  assert.ok(staleRejected)
  assert.ok(
    replacementToken,
    "observed replacement worker's fresh token before completion"
  )
  const valid = await db.resumeUpload.findUniqueOrThrow({
    where: { id: upload.id },
  })
  assert.equal(valid.detectedFormat, "pdf")
  assert.ok(valid.contentSha256)
  console.log({
    check:
      "actual schedule reclaimed expired lease; fresh token observed; stale completion denied",
    passed: true,
    runId: completed.id,
    attempt: completed.attempt,
    status: completed.status,
  })
} finally {
  for (const key of keys) await storage.remove(key)
  await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
  await db.resumeUpload.deleteMany({ where: { ownerUserId: owner } })
  await db.resume.deleteMany({ where: { ownerUserId: owner } })
  await db.userProfile.delete({ where: { id: owner } })
  await db.$disconnect()
  s3.destroy()
}
