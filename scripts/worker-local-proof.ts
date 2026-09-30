import nextEnv from "@next/env"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createStorageClient } from "../lib/backend/create-storage-client"
import { createS3Transport } from "../lib/backend/s3-transport"
import { createUploadRepository } from "../lib/domain/resume-upload/repository"
import { createUploadService } from "../lib/domain/resume-upload/service"
import { createSessionContext } from "../lib/auth/session-context"
import { tinyPdf, tinyDocx } from "../tests/validation-fixtures"
nextEnv.loadEnvConfig(process.cwd())
const env = process.env
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
const storage = createS3Transport(s3)
const owner = `worker-local-proof-${randomUUID()}`
await db.userProfile.create({ data: { id: owner } })
const user = await createSessionContext(
  async () => ({ data: { user: { id: owner } }, error: null }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
const service = createUploadService(createUploadRepository(db), storage)
const origin = process.env.WORKER_LOCAL_ORIGIN ?? "http://localhost:8787"
const keys: string[] = []
async function replay(
  path: string,
  type: string,
  data: unknown,
  header = true
) {
  const invocation = randomUUID()
  return fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "X-Neon-Trigger-Invocation-Id": invocation } : {}),
    },
    body: JSON.stringify({
      version: 1,
      invocation_id: invocation,
      trigger: { id: "local-proof", name: "local-proof", type },
      data,
    }),
  })
}
try {
  assert.equal(
    (
      await replay(
        "/recover",
        "schedule",
        { scheduled_at: new Date().toISOString() },
        false
      )
    ).status,
    403
  )
  for (const format of ["pdf", "docx"] as const) {
    const bytes = format === "pdf" ? tinyPdf() : tinyDocx()
    const intent = await service.createResumeUploadIntent(user, {
      fileName: `test.${format}`,
      contentType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
    if (format === "pdf") {
      const data = {
        bucket_name: "jobsync-files",
        object_key: upload.objectKey,
      }
      assert.ok(
        (await replay("/object-created", "storage_object_created", data)).ok
      )
      assert.ok(
        (await replay("/object-created", "storage_object_created", data)).ok
      )
    } else {
      await service.reconcileStoredResumeUpload(upload.objectKey)
      assert.ok(
        (
          await replay("/recover", "schedule", {
            scheduled_at: new Date().toISOString(),
          })
        ).ok
      )
    }
    // A deployed object trigger may own the same lease while local replay runs.
    // Wait for the durable result rather than assuming this invocation claimed it.
    const deadline = Date.now() + 10_000
    let valid = await db.resumeUpload.findUniqueOrThrow({
      where: { id: upload.id },
    })
    while (!valid.validationCompletedAt && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      valid = await db.resumeUpload.findUniqueOrThrow({
        where: { id: upload.id },
      })
    }
    assert.equal(valid.detectedFormat, format)
    assert.ok(valid.validationCompletedAt)
    assert.match(valid.contentSha256!, /^[0-9a-f]{64}$/)
    assert.equal(
      await db.processingRun.count({ where: { resourceId: upload.id } }),
      1
    )
    console.log({ check: `local ${format} connectivity/replay`, passed: true })
  }
  const ignored = await replay("/object-created", "storage_object_created", {
    bucket_name: "jobsync-files",
    object_key: "unknown",
  })
  assert.deepEqual(await ignored.json(), { status: "ignored" })
  console.log({
    check: "direct-call rejection and unknown-key ignore",
    passed: true,
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
