import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { ResumeUpload } from "../lib/generated/prisma/client"
import { createSessionContext } from "../lib/auth/session-context"
import {
  createUploadService,
  UploadError,
  type UploadRepository,
  type UploadSettlement,
  type UploadStorage,
} from "../lib/storage/upload-service"
import {
  MAX_RESUME_FILE_SIZE_BYTES,
  resumeObjectKey,
  uploadIntentSchema,
} from "../lib/storage/resume-file"

const PDF = "application/pdf"
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

async function verifiedUser(id: string) {
  return createSessionContext(
    async () => ({
      data: { user: { id, name: "Storage test", email: null } },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
}

class MemoryRepository implements UploadRepository {
  readonly records = new Map<string, ResumeUpload>()
  readonly resumes = new Map<string, { ownerId: string; title: string }>()

  async createPending(
    upload: ResumeUpload,
    title: string,
    existingResume: boolean
  ) {
    if (existingResume) {
      const resume = this.resumes.get(upload.resumeId)
      if (!resume || resume.ownerId !== upload.ownerUserId) {
        throw new UploadError("resume_not_found", 404)
      }
    } else {
      this.resumes.set(upload.resumeId, { ownerId: upload.ownerUserId, title })
    }
    this.records.set(upload.id, upload)
    return upload
  }

  async findOwned(id: string, ownerId: string) {
    const upload = this.records.get(id)
    return upload?.ownerUserId === ownerId ? upload : null
  }

  async findByObjectKey(objectKey: string) {
    return (
      [...this.records.values()].find(
        (upload) => upload.objectKey === objectKey
      ) ?? null
    )
  }

  async settlePending(id: string, settlement: UploadSettlement) {
    const upload = this.records.get(id)
    if (!upload) throw new Error("Missing test upload")
    if (upload.status === "pending") {
      const settled = { ...upload, ...settlement, updatedAt: new Date() }
      this.records.set(id, settled)
      return settled
    }
    return upload
  }
}

class MemoryStorage implements UploadStorage {
  readonly calls: Array<{
    operation: string
    key: string
    seconds?: number
    contentType?: string
  }> = []
  headResult: Awaited<ReturnType<UploadStorage["head"]>> = null
  signPutFailure = false
  signGetFailure = false
  removeFailure = false

  async signPut(key: string, contentType: string, seconds: number) {
    this.calls.push({ operation: "put", key, contentType, seconds })
    if (this.signPutFailure)
      throw new Error("provider detail must remain private")
    return `https://storage.invalid/signed/${randomUUID()}`
  }
  async head(key: string) {
    this.calls.push({ operation: "head", key })
    return this.headResult
  }
  async remove(key: string) {
    this.calls.push({ operation: "remove", key })
    if (this.removeFailure) throw new Error("provider detail")
  }
  async signGet(key: string, seconds: number) {
    this.calls.push({ operation: "get", key, seconds })
    if (this.signGetFailure)
      throw new Error("provider detail must remain private")
    return `https://storage.invalid/signed/${randomUUID()}`
  }
}

function service(now = () => new Date("2026-09-30T12:00:00.000Z")) {
  const repository = new MemoryRepository()
  const storage = new MemoryStorage()
  const uploadService = createUploadService(repository, storage, now)
  return { repository, storage, uploadService }
}

test("metadata validation accepts PDF and DOCX and rejects unsafe metadata", () => {
  const valid = (fileName: string, contentType: string, sizeBytes = 1024) =>
    uploadIntentSchema.safeParse({ fileName, contentType, sizeBytes })

  assert.equal(valid("resume.pdf", PDF).success, true)
  assert.equal(valid("resume.docx", DOCX).success, true)
  assert.equal(
    valid("resume.pdf", PDF, MAX_RESUME_FILE_SIZE_BYTES).success,
    true
  )
  for (const invalid of [
    { fileName: "resume.pdf", contentType: PDF, sizeBytes: 0 },
    {
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: MAX_RESUME_FILE_SIZE_BYTES + 1,
    },
    {
      fileName: "resume.exe",
      contentType: "application/octet-stream",
      sizeBytes: 10,
    },
    { fileName: "resume.docx", contentType: PDF, sizeBytes: 10 },
    { fileName: "../resume.pdf", contentType: PDF, sizeBytes: 10 },
    { fileName: "folder\\resume.pdf", contentType: PDF, sizeBytes: 10 },
    { fileName: "bad\nname.pdf", contentType: PDF, sizeBytes: 10 },
    { fileName: "", contentType: PDF, sizeBytes: 10 },
    { fileName: `${"a".repeat(252)}.pdf`, contentType: PDF, sizeBytes: 10 },
  ]) {
    assert.equal(uploadIntentSchema.safeParse(invalid).success, false)
  }
})

test("object keys use opaque server identifiers and type-mapped extensions", () => {
  const key1 = resumeObjectKey("auth_user_123", randomUUID(), randomUUID(), PDF)
  const key2 = resumeObjectKey(
    "auth_user_123",
    randomUUID(),
    randomUUID(),
    DOCX
  )
  assert.match(
    key1,
    /^users\/auth_user_123\/resumes\/[a-f0-9-]+\/uploads\/[a-f0-9-]+\/original\.pdf$/
  )
  assert.match(key2, /\/original\.docx$/)
  assert.notEqual(key1, key2)
  assert.throws(() =>
    resumeObjectKey("../owner", randomUUID(), randomUUID(), PDF)
  )
  assert.throws(() => resumeObjectKey("owner", randomUUID(), "file.pdf", PDF))
})

test("intent persists before presigning and does not let filename control key", async () => {
  const { repository, storage, uploadService } = service()
  const user = await verifiedUser("owner-a")
  const signPut = storage.signPut.bind(storage)
  storage.signPut = async (key, contentType, seconds) => {
    assert.ok(
      [...repository.records.values()].some(
        (record) => record.objectKey === key && record.status === "pending"
      )
    )
    return signPut(key, contentType, seconds)
  }
  const first = await uploadService.createResumeUploadIntent(user, {
    fileName: "candidate-final.pdf",
    contentType: PDF,
    sizeBytes: 2048,
  })
  const second = await uploadService.createResumeUploadIntent(user, {
    fileName: "candidate-final.pdf",
    contentType: PDF,
    sizeBytes: 2048,
  })

  assert.equal(repository.records.size, 2)
  assert.equal(repository.records.get(first.uploadId)?.status, "pending")
  assert.ok(
    repository.records.get(first.uploadId)!.objectKey.endsWith("/original.pdf")
  )
  assert.notEqual(
    repository.records.get(first.uploadId)?.objectKey,
    repository.records.get(second.uploadId)?.objectKey
  )
  assert.equal(storage.calls[0]?.operation, "put")
  assert.equal(
    storage.calls[0]?.key,
    repository.records.get(first.uploadId)?.objectKey
  )
  assert.equal(storage.calls[0]?.contentType, PDF)
  assert.equal(storage.calls[0]?.seconds, 300)
  assert.deepEqual(first.upload.headers, {
    "Content-Type": PDF,
    "If-None-Match": "*",
  })
  assert.equal(first.upload.method, "PUT")
  assert.ok(!("ownerUserId" in first))
  assert.ok(!("accessKeyId" in first))
  assert.ok(!("secretAccessKey" in first))
  assert.equal(first.expiresAt, "2026-09-30T12:05:00.000Z")
})

test("intent validation occurs before persistence and signing failures leave pending records", async () => {
  const { repository, storage, uploadService } = service()
  const user = await verifiedUser("owner-a")
  await assert.rejects(
    uploadService.createResumeUploadIntent(user, {
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: 0,
    }),
    (error) => error instanceof UploadError && error.status === 400
  )
  assert.equal(repository.records.size, 0)

  storage.signPutFailure = true
  await assert.rejects(
    uploadService.createResumeUploadIntent(user, {
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: 10,
    }),
    (error) =>
      error instanceof UploadError &&
      error.code === "storage_unavailable" &&
      error.status === 503
  )
  assert.equal(repository.records.size, 1)
  assert.equal([...repository.records.values()][0]?.status, "pending")
})

test("intent only links a resume owned by the authenticated user", async () => {
  const { repository, uploadService } = service()
  repository.resumes.set("22222222-2222-4222-8222-222222222222", {
    ownerId: "owner-a",
    title: "Owner A resume",
  })
  const ownerA = await verifiedUser("owner-a")
  const ownerB = await verifiedUser("owner-b")
  const intent = await uploadService.createResumeUploadIntent(ownerA, {
    resumeId: "22222222-2222-4222-8222-222222222222",
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  assert.equal(repository.records.get(intent.uploadId)?.ownerUserId, ownerA.id)
  await assert.rejects(
    uploadService.createResumeUploadIntent(ownerB, {
      resumeId: "22222222-2222-4222-8222-222222222222",
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: 10,
    }),
    (error) =>
      error instanceof UploadError &&
      error.code === "resume_not_found" &&
      error.status === 404
  )
  await assert.rejects(
    uploadService.createResumeUploadIntent(ownerB, {
      resumeId: randomUUID(),
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: 10,
    }),
    (error) =>
      error instanceof UploadError &&
      error.code === "resume_not_found" &&
      error.status === 404
  )
})

test("matching object becomes uploaded and repeated completion is idempotent", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 1024,
  })
  const record = repository.records.get(intent.uploadId)!
  storage.headResult = { size: 1024, contentType: PDF, etag: '"abc"' }

  const first = await uploadService.reconcileResumeUpload(
    owner,
    intent.uploadId
  )
  const second = await uploadService.reconcileResumeUpload(
    owner,
    intent.uploadId
  )
  const persisted = repository.records.get(intent.uploadId)!
  assert.equal(first.status, "uploaded")
  assert.deepEqual(second, first)
  assert.equal(persisted.status, "uploaded")
  assert.equal(persisted.actualSizeBytes, BigInt(1024))
  assert.equal(persisted.actualContentType, PDF)
  assert.equal(persisted.etag, '"abc"')
  assert.ok(persisted.uploadedAt)
  assert.equal(
    storage.calls.filter(
      (call) => call.operation === "head" && call.key === record.objectKey
    ).length,
    1
  )
})

test("missing objects remain pending and invalid actual metadata is rejected", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 1024,
  })
  await assert.rejects(
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
    (error) =>
      error instanceof UploadError &&
      error.code === "object_not_uploaded" &&
      error.status === 409
  )
  assert.equal(repository.records.get(intent.uploadId)?.status, "pending")

  storage.headResult = {
    size: MAX_RESUME_FILE_SIZE_BYTES + 1,
    contentType: PDF,
    etag: undefined,
  }
  await assert.rejects(
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
    UploadError
  )
  assert.equal(repository.records.get(intent.uploadId)?.status, "rejected")
  assert.equal(
    repository.records.get(intent.uploadId)?.rejectionCode,
    "object_too_large"
  )
  assert.ok(storage.calls.some((call) => call.operation === "remove"))
})

test("objects above the Postgres int range remain durably rejected", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  const actualSize = 2_147_483_648
  storage.headResult = {
    size: actualSize,
    contentType: PDF,
    etag: "large-object",
  }

  await assert.rejects(
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
    (error) => error instanceof UploadError && error.code === "upload_rejected"
  )
  const rejected = repository.records.get(intent.uploadId)!
  assert.equal(rejected.status, "rejected")
  assert.equal(rejected.actualSizeBytes, BigInt(actualSize))
  assert.equal(rejected.rejectionCode, "object_too_large")
})

test("actual content type and size must match declared metadata", async () => {
  for (const object of [
    { size: 10, contentType: DOCX, etag: undefined },
    { size: 11, contentType: PDF, etag: undefined },
    { size: 0, contentType: PDF, etag: undefined },
  ]) {
    const { repository, storage, uploadService } = service()
    const owner = await verifiedUser("owner-a")
    const intent = await uploadService.createResumeUploadIntent(owner, {
      fileName: "resume.pdf",
      contentType: PDF,
      sizeBytes: 10,
    })
    storage.headResult = object
    storage.removeFailure = true
    await assert.rejects(
      uploadService.reconcileResumeUpload(owner, intent.uploadId),
      UploadError
    )
    assert.equal(repository.records.get(intent.uploadId)?.status, "rejected")
    assert.ok(repository.records.get(intent.uploadId)?.rejectionCode)
  }
})

test("concurrent completion calls converge on one uploaded state", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  storage.headResult = { size: 10, contentType: PDF, etag: "etag" }
  const results = await Promise.all([
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
  ])
  assert.deepEqual(results[0], results[1])
  assert.equal(repository.records.get(intent.uploadId)?.status, "uploaded")
})

test("stored-object reconciliation resolves only a persisted key and uses persisted ownership", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-from-record")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  const record = repository.records.get(intent.uploadId)!
  storage.headResult = { size: 10, contentType: PDF, etag: "stored-etag" }

  await assert.rejects(
    uploadService.reconcileStoredResumeUpload(
      "users/forged-owner/resumes/forged-resume/uploads/forged-upload/original.pdf"
    ),
    (error) =>
      error instanceof UploadError &&
      error.code === "upload_not_found" &&
      error.status === 404
  )
  assert.equal(
    storage.calls.some((call) => call.operation === "head"),
    false
  )

  const result = await uploadService.reconcileStoredResumeUpload(
    record.objectKey
  )
  assert.equal(result.uploadId, record.id)
  assert.equal(repository.records.get(record.id)?.ownerUserId, owner.id)
  assert.equal(repository.records.get(record.id)?.status, "uploaded")
  assert.equal(storage.calls.at(-1)?.operation, "head")
  assert.equal(storage.calls.at(-1)?.key, record.objectKey)
})

test("foreign and nonexistent upload IDs have equivalent authorization behavior", async () => {
  const { repository, storage, uploadService } = service()
  const ownerA = await verifiedUser("owner-a")
  const ownerB = await verifiedUser("owner-b")
  const intent = await uploadService.createResumeUploadIntent(ownerA, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  const record = repository.records.get(intent.uploadId)!
  await repository.settlePending(record.id, {
    status: "uploaded",
    actualSizeBytes: BigInt(10),
    actualContentType: PDF,
    etag: "etag",
    uploadedAt: new Date(),
    rejectionCode: null,
  })
  await assert.rejects(
    uploadService.reconcileResumeUpload(ownerB, intent.uploadId),
    (error) =>
      error instanceof UploadError &&
      error.code === "upload_not_found" &&
      error.status === 404
  )
  await assert.rejects(
    uploadService.reconcileResumeUpload(ownerB, randomUUID()),
    (error) =>
      error instanceof UploadError &&
      error.code === "upload_not_found" &&
      error.status === 404
  )
  await assert.rejects(
    uploadService.createDownloadUrl(ownerB, intent.uploadId),
    (error) =>
      error instanceof UploadError &&
      error.code === "upload_not_found" &&
      error.status === 404
  )
  assert.equal(
    storage.calls.some((call) => call.operation === "get"),
    false
  )
})

test("download URL uses the stored key for 60 seconds and only uploaded state is downloadable", async () => {
  const { repository, storage, uploadService } = service()
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  await assert.rejects(
    uploadService.createDownloadUrl(owner, intent.uploadId),
    UploadError
  )
  const record = repository.records.get(intent.uploadId)!
  await repository.settlePending(record.id, {
    status: "uploaded",
    actualSizeBytes: BigInt(10),
    actualContentType: PDF,
    etag: "etag",
    uploadedAt: new Date(),
    rejectionCode: null,
  })
  const signed = await uploadService.createDownloadUrl(owner, intent.uploadId)
  assert.equal(signed.expiresIn, 60)
  assert.equal(storage.calls.at(-1)?.operation, "get")
  assert.equal(storage.calls.at(-1)?.key, record.objectKey)
  assert.equal(storage.calls.at(-1)?.seconds, 60)
  assert.ok(!("objectKey" in signed))
})

test("expired pending uploads settle as expired and cleanup failure does not accept them", async () => {
  const base = new Date("2026-09-30T12:00:00.000Z")
  let current = base
  const { repository, storage, uploadService } = service(() => current)
  const owner = await verifiedUser("owner-a")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  current = new Date(base.getTime() + 301_000)
  storage.removeFailure = true
  await assert.rejects(
    uploadService.reconcileResumeUpload(owner, intent.uploadId),
    UploadError
  )
  assert.equal(repository.records.get(intent.uploadId)?.status, "expired")
  const status = await uploadService.readStatus(owner, intent.uploadId)
  assert.equal(status.validation.state, "rejected")
  assert.match(status.validation.message!, /expired before the file arrived/)
  assert.equal(
    storage.calls.some((call) => call.operation === "head"),
    true
  )
})

test("owner status read exposes only safe validation state and foreign IDs are 404", async () => {
  const { repository, uploadService } = service()
  const owner = await verifiedUser("status-owner"),
    foreign = await verifiedUser("status-foreign")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  const pending = await uploadService.readStatus(owner, intent.uploadId)
  assert.deepEqual(pending, {
    uploadId: intent.uploadId,
    status: "pending",
    validation: { state: "pending", completedAt: null, message: null },
  })
  await assert.rejects(
    uploadService.readStatus(foreign, intent.uploadId),
    (error) => error instanceof UploadError && error.status === 404
  )
  await assert.rejects(
    uploadService.readStatus(owner, randomUUID()),
    (error) => error instanceof UploadError && error.status === 404
  )
  const upload = repository.records.get(intent.uploadId)!
  repository.records.set(upload.id, {
    ...upload,
    status: "uploaded",
    validationCompletedAt: new Date("2026-09-30T12:00:00Z"),
    detectedFormat: "pdf",
    contentSha256: "a".repeat(64),
  })
  const valid = await uploadService.readStatus(owner, upload.id)
  assert.equal(valid.validation.state, "valid")
  assert.ok(!JSON.stringify(valid).includes(upload.objectKey))
  assert.ok(!("contentSha256" in valid))
})

test("delayed reconciliation accepts timely immutable object and expires late upload", async () => {
  const created = new Date("2026-09-30T12:00:00.500Z")
  let current = created
  const { repository, storage, uploadService } = service(() => current)
  const owner = await verifiedUser("delayed-owner")
  const intent = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  storage.headResult = {
    size: 10,
    contentType: PDF,
    etag: "test",
    lastModified: new Date("2026-09-30T12:00:00Z"),
  }
  current = new Date("2026-09-30T13:00:00Z")
  assert.equal(
    (
      await uploadService.reconcileStoredResumeUpload(
        repository.records.get(intent.uploadId)!.objectKey
      )
    ).status,
    "uploaded"
  )
  current = created
  const late = await uploadService.createResumeUploadIntent(owner, {
    fileName: "resume.pdf",
    contentType: PDF,
    sizeBytes: 10,
  })
  storage.headResult = {
    size: 10,
    contentType: PDF,
    etag: "test",
    lastModified: new Date("2026-09-30T12:06:00Z"),
  }
  current = new Date("2026-09-30T13:00:00Z")
  await assert.rejects(
    uploadService.reconcileStoredResumeUpload(
      repository.records.get(late.uploadId)!.objectKey
    ),
    UploadError
  )
  assert.equal(repository.records.get(late.uploadId)!.status, "expired")
})
