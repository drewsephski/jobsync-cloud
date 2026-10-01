import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createStorageClient } from "../lib/backend/create-storage-client"
import { resumeDocx, sanitizedResume } from "../tests/resume-structure-fixtures"
import { validateGroundedResume } from "../lib/ai/resume-schema"
import { RESUME_AI_CONFIG } from "../lib/ai/config"
nextEnv.loadEnvConfig(process.cwd())
const env = process.env
assert.equal(
  env.JOBSYNC_AI_LIVE_BRANCH,
  "lively-shape-65452824/br-tiny-tree-b44fo1lv",
  "explicit isolated-branch gate required"
)
assert.ok(
  new URL(env.DATABASE_URL!).hostname.startsWith("ep-green-scene-b45djevq")
)
assert.ok(
  new URL(env.AWS_ENDPOINT_URL_S3!).hostname.startsWith(
    "br-tiny-tree-b44fo1lv."
  )
)
assert.ok(env.OPENROUTER_API_KEY)
const db = createDatabaseClient(env.DATABASE_URL!)
const s3 = createStorageClient({
  endpoint: env.AWS_ENDPOINT_URL_S3!,
  region: env.AWS_REGION!,
  accessKeyId: env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
})
const owner = `ai-live-proof-${randomUUID()}`
const bytes = resumeDocx()
let key: string | undefined
const baseline = await db.userProfile.findMany({
  select: { id: true, displayName: true, createdAt: true },
  orderBy: { id: "asc" },
})
assert.ok(
  baseline.length === 1,
  "run live proof after test fixtures are cleaned; preserve founder"
)
let uploadId: string | undefined
try {
  await db.userProfile.create({ data: { id: owner } })
  const resume = await db.resume.create({
    data: { ownerUserId: owner, title: "Sanitized AI proof" },
  })
  uploadId = randomUUID()
  key = `users/${owner}/resumes/${resume.id}/uploads/${uploadId}/original.docx`
  await db.resumeUpload.create({
    data: {
      id: uploadId,
      ownerUserId: owner,
      resumeId: resume.id,
      objectKey: key,
      originalFileName: "sanitized.docx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      declaredSizeBytes: bytes.length,
      expiresAt: new Date(Date.now() + 300_000),
    },
  })
  const start = Date.now()
  await s3.send(
    new PutObjectCommand({
      Bucket: "jobsync-files",
      Key: key,
      Body: bytes,
      ContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      IfNoneMatch: "*",
    })
  )
  const deadline = Date.now() + 120_000
  let draft: Awaited<ReturnType<typeof db.resumeVersion.findFirst>> = null
  while (Date.now() < deadline) {
    draft = await db.resumeVersion.findFirst({
      where: { sourceUploadId: uploadId, ownerUserId: owner },
    })
    if (draft) break
    const run = await db.processingRun.findFirst({
      where: { ownerUserId: owner, kind: "resume_structure_v1" },
    })
    if (run?.status === "failed")
      throw new Error(`live_structuring_failed:${run.errorCode}`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  assert.ok(
    draft,
    "deployed trigger must create a draft without browser or local worker"
  )
  assert.equal(draft.status, "draft")
  assert.equal(draft.extractedText, null)
  const source = (await import("../lib/validation/extract")).extractResumeText
  const upload = await db.resumeUpload.findUniqueOrThrow({
    where: { id: uploadId },
  })
  const text = await source(bytes, "docx", upload.contentSha256!)
  const data = validateGroundedResume(draft.data, text)
  assert.equal(data.contact.name, sanitizedResume.contact.name)
  assert.equal(data.contact.email, sanitizedResume.contact.email)
  assert.equal(data.employment.length, 1)
  assert.equal(data.employment[0].employer, "Example Labs")
  assert.equal(data.employment[0].startDate, "January 2022")
  assert.equal(data.employment[0].endDate, "March 2025")
  assert.equal(data.education.length, 1)
  assert.equal(data.credentials.length, 1)
  assert.deepEqual([...data.skills].sort(), [...sanitizedResume.skills].sort())
  assert.equal(data.contact.phone, null)
  const usage = await db.aiUsage.findFirstOrThrow({
    where: { ownerUserId: owner },
  })
  assert.ok(usage.costMicroUsd !== null, "actual OpenRouter cost required")
  assert.equal(usage.model, RESUME_AI_CONFIG.model)
  const reservation = await db.aiUsageReservation.findFirstOrThrow({
    where: { ownerUserId: owner },
  })
  assert.equal(reservation.status, "settled")
  assert.equal(reservation.finalCostMicroUsd, usage.costMicroUsd)
  const runs = await db.processingRun.findMany({
    where: { ownerUserId: owner },
    select: { id: true, kind: true, attempt: true, status: true },
  })
  assert.equal(
    await db.resumeVersion.count({ where: { ownerUserId: owner } }),
    1
  )
  assert.equal(await db.aiUsage.count({ where: { ownerUserId: owner } }), 1)
  // One replayed immutable upload event cannot overwrite the source.
  await assert.rejects(
    s3.send(
      new PutObjectCommand({
        Bucket: "jobsync-files",
        Key: key,
        Body: bytes,
        ContentType: upload.declaredContentType,
        IfNoneMatch: "*",
      })
    )
  )
  console.log(
    JSON.stringify({
      proof: "deployed-object-trigger-to-draft",
      uploadId,
      draftId: draft.id,
      wallLatencyMs: Date.now() - start,
      model: usage.model,
      provider: usage.provider,
      providerRequestId: usage.providerRequestId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicroUsd: usage.costMicroUsd.toString(),
      metadata: usage.metadata,
      reservationStatus: reservation.status,
      runs,
      quality: {
        sourceGrounded: true,
        employment: 1,
        education: 1,
        credentials: 1,
        skills: 2,
        unknownPhone: null,
        exactDates: true,
      },
      retries: runs.reduce((sum, run) => sum + run.attempt - 1, 0),
    })
  )
  if (env.JOBSYNC_AI_PROOF_PAUSE === "1") {
    // Optional browser QA reads the same sanitized fixture; cleanup follows automatically.
    console.log(JSON.stringify({ browserQaReady: true, uploadId, owner }))
    await new Promise((resolve) => setTimeout(resolve, 45_000))
  }
} finally {
  if (key)
    await s3.send(
      new DeleteObjectCommand({ Bucket: "jobsync-files", Key: key })
    )
  await db.resumeVersion.deleteMany({ where: { ownerUserId: owner } })
  await db.aiUsage.deleteMany({ where: { ownerUserId: owner } })
  await db.aiUsageReservation.deleteMany({ where: { ownerUserId: owner } })
  await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
  await db.resumeUpload.deleteMany({ where: { ownerUserId: owner } })
  await db.resume.deleteMany({ where: { ownerUserId: owner } })
  await db.userProfile.deleteMany({ where: { id: owner } })
  assert.deepEqual(
    await db.userProfile.findMany({
      select: { id: true, displayName: true, createdAt: true },
      orderBy: { id: "asc" },
    }),
    baseline
  )
  console.log(JSON.stringify({ cleanup: "complete", founderPreserved: true }))
  await db.$disconnect()
  s3.destroy()
}
