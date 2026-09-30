import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import type { Prisma, ResumeUpload } from "../lib/generated/prisma/client"
import { createSessionContext } from "../lib/auth/session-context"
import {
  createUploadService,
  type UploadStorage,
} from "../lib/storage/upload-service"
import { MAX_RESUME_FILE_SIZE_BYTES } from "../lib/storage/resume-file"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
const { db } = await import("../lib/db")
const { uploadRepository } = await import("../lib/storage/uploads")

after(async () => db.$disconnect())

async function expectRejectedWrite(
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  expectedCode: string | string[]
) {
  const rollback = new Error("Rollback storage database test")
  let errorCode: string | undefined
  try {
    await db.$transaction(async (tx) => {
      try {
        await write(tx)
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          errorCode = String(error.code)
        }
      }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw new Error("Test transaction failed")
  }
  assert.ok(
    (Array.isArray(expectedCode) ? expectedCode : [expectedCode]).includes(
      errorCode ?? ""
    )
  )
}

async function createOwners(tx: Prisma.TransactionClient) {
  const first = `storage-test-${randomUUID()}`
  const second = `storage-test-${randomUUID()}`
  await tx.userProfile.createMany({ data: [{ id: first }, { id: second }] })
  return { first, second }
}

function uploadData(
  ownerUserId: string,
  resumeId: string,
  overrides: Partial<ResumeUpload> = {}
): ResumeUpload {
  const now = new Date()
  return {
    id: randomUUID(),
    ownerUserId,
    resumeId,
    objectKey: `users/${ownerUserId}/resumes/${resumeId}/uploads/${randomUUID()}/original.pdf`,
    originalFileName: "resume.pdf",
    declaredContentType: "application/pdf",
    declaredSizeBytes: 1024,
    actualContentType: null,
    actualSizeBytes: null,
    etag: null,
    status: "pending",
    expiresAt: new Date(now.getTime() + 60_000),
    uploadedAt: null,
    rejectionCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

test("ResumeUpload composite foreign key prevents cross-owner resume references", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first, second } = await createOwners(tx)
    const resume = await tx.resume.create({
      data: { ownerUserId: first, title: "Storage constraint test" },
    })
    await tx.resumeUpload.create({
      data: uploadData(second, resume.id),
    })
  }, "P2003")
})

test("ResumeUpload object keys are unique", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first } = await createOwners(tx)
    const resume = await tx.resume.create({
      data: { ownerUserId: first, title: "Storage key test" },
    })
    const firstUpload = uploadData(first, resume.id)
    await tx.resumeUpload.create({ data: firstUpload })
    await tx.resumeUpload.create({
      data: uploadData(first, resume.id, { objectKey: firstUpload.objectKey }),
    })
  }, "P2002")
})

test("ResumeUpload database checks enforce size and expiry invariants", async () => {
  await expectRejectedWrite(
    async (tx) => {
      const { first } = await createOwners(tx)
      const resume = await tx.resume.create({
        data: { ownerUserId: first, title: "Storage check test" },
      })
      await tx.resumeUpload.create({
        data: uploadData(first, resume.id, { declaredSizeBytes: 0 }),
      })
    },
    ["P2010", "P2039"]
  )

  await expectRejectedWrite(
    async (tx) => {
      const { first } = await createOwners(tx)
      const resume = await tx.resume.create({
        data: { ownerUserId: first, title: "Storage upper size test" },
      })
      await tx.resumeUpload.create({
        data: uploadData(first, resume.id, {
          declaredSizeBytes: MAX_RESUME_FILE_SIZE_BYTES + 1,
        }),
      })
    },
    ["P2010", "P2039"]
  )

  await expectRejectedWrite(
    async (tx) => {
      const { first } = await createOwners(tx)
      const resume = await tx.resume.create({
        data: { ownerUserId: first, title: "Storage expiry test" },
      })
      const now = new Date()
      await tx.resumeUpload.create({
        data: uploadData(first, resume.id, {
          createdAt: now,
          expiresAt: new Date(now.getTime() - 1),
        }),
      })
    },
    ["P2010", "P2039"]
  )

  await expectRejectedWrite(
    async (tx) => {
      const { first } = await createOwners(tx)
      const resume = await tx.resume.create({
        data: { ownerUserId: first, title: "Uploaded metadata test" },
      })
      await tx.resumeUpload.create({
        data: uploadData(first, resume.id, { status: "uploaded" }),
      })
    },
    ["P2010", "P2039"]
  )
})

test("production repository creates an upload for the requested owner and denies foreign resume IDs", async () => {
  const ownerA = `storage-repo-test-${randomUUID()}`
  const ownerB = `storage-repo-test-${randomUUID()}`
  const resumeId = randomUUID()
  const uploadId = randomUUID()
  await db.userProfile.createMany({ data: [{ id: ownerA }, { id: ownerB }] })
  try {
    const resume = await db.resume.create({
      data: { id: resumeId, ownerUserId: ownerA, title: "Owned resume" },
    })
    const uploadDataForOwner = uploadData(ownerA, resume.id)
    const upload = await uploadRepository.createPending(
      {
        ...uploadDataForOwner,
        id: uploadId,
        objectKey: `users/${ownerA}/resumes/${resume.id}/uploads/${uploadId}/original.pdf`,
      },
      "Ignored for an existing resume",
      true
    )
    assert.equal(upload.ownerUserId, ownerA)
    assert.equal(upload.resumeId, resume.id)
    assert.equal(upload.status, "pending")
    assert.equal(
      upload.createdAt.getTime(),
      uploadDataForOwner.createdAt.getTime()
    )

    const foreignUpload = {
      ...uploadData(ownerB, resume.id),
      id: randomUUID(),
      objectKey: `users/${ownerB}/resumes/${resume.id}/uploads/${randomUUID()}/original.pdf`,
    }
    await assert.rejects(
      uploadRepository.createPending(foreignUpload, "Foreign", true),
      (error) =>
        error instanceof Error && "status" in error && error.status === 404
    )
    assert.equal(
      await db.resumeUpload.count({ where: { ownerUserId: ownerB } }),
      0
    )
  } finally {
    await db.resumeUpload.deleteMany({
      where: { ownerUserId: { in: [ownerA, ownerB] } },
    })
    await db.resume.deleteMany({
      where: { ownerUserId: { in: [ownerA, ownerB] } },
    })
    await db.userProfile.deleteMany({ where: { id: { in: [ownerA, ownerB] } } })
  }
})

test("concurrent Postgres completion settles one upload and preserves winning metadata", async () => {
  const ownerId = `storage-race-test-${randomUUID()}`
  await db.userProfile.create({ data: { id: ownerId } })
  const user = await createSessionContext(
    async () => ({
      data: { user: { id: ownerId, name: "Race test", email: null } },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
  const objectMetadata = {
    size: 42,
    contentType: "application/pdf",
    etag: '"stable-etag"',
  }
  let headCalls = 0
  const storage: UploadStorage = {
    async signPut() {
      return "https://storage.invalid/unused"
    },
    async head() {
      headCalls++
      return objectMetadata
    },
    async remove() {},
    async signGet() {
      return "https://storage.invalid/unused"
    },
  }
  const service = createUploadService(uploadRepository, storage)
  let uploadId: string | undefined
  let resumeId: string | undefined
  try {
    const intent = await service.createResumeUploadIntent(user, {
      fileName: "resume.pdf",
      contentType: "application/pdf",
      sizeBytes: objectMetadata.size,
    })
    uploadId = intent.uploadId
    resumeId = intent.resumeId

    await assert.rejects(
      service.reconcileStoredResumeUpload(
        "users/forged-owner/resumes/forged-resume/uploads/forged-upload/original.pdf"
      ),
      (error) =>
        error instanceof Error && "status" in error && error.status === 404
    )
    assert.equal(headCalls, 0)

    const [first, second] = await Promise.all([
      service.reconcileResumeUpload(user, uploadId),
      service.reconcileResumeUpload(user, uploadId),
    ])
    const persisted = await db.resumeUpload.findUniqueOrThrow({
      where: { id: uploadId },
    })
    assert.equal(first.status, "uploaded")
    assert.deepEqual(second, first)
    assert.equal(persisted.status, "uploaded")
    assert.equal(persisted.actualSizeBytes, BigInt(objectMetadata.size))
    assert.equal(persisted.actualContentType, objectMetadata.contentType)
    assert.equal(persisted.etag, objectMetadata.etag)
    assert.equal(persisted.uploadedAt?.toISOString(), first.uploadedAt)
    assert.ok(first.uploadedAt)

    const repeated = await service.reconcileResumeUpload(user, uploadId)
    const afterRepeat = await db.resumeUpload.findUniqueOrThrow({
      where: { id: uploadId },
    })
    assert.deepEqual(repeated, first)
    assert.equal(
      afterRepeat.uploadedAt?.getTime(),
      persisted.uploadedAt?.getTime()
    )
    assert.equal(afterRepeat.actualSizeBytes, persisted.actualSizeBytes)
    assert.equal(afterRepeat.actualContentType, persisted.actualContentType)
    assert.equal(afterRepeat.etag, persisted.etag)

    const triggerReplay = await service.reconcileStoredResumeUpload(
      persisted.objectKey
    )
    assert.deepEqual(triggerReplay, first)
    assert.equal(headCalls, 2)
  } finally {
    if (uploadId) {
      await db.resumeUpload.deleteMany({ where: { id: uploadId } })
    }
    if (resumeId) {
      await db.resume.deleteMany({
        where: { id: resumeId, ownerUserId: ownerId },
      })
    }
    await db.userProfile.deleteMany({ where: { id: ownerId } })
  }
})

test("Postgres durably rejects objects above the signed 32-bit size range", async () => {
  const ownerId = `storage-large-test-${randomUUID()}`
  await db.userProfile.create({ data: { id: ownerId } })
  const user = await createSessionContext(
    async () => ({
      data: { user: { id: ownerId, name: "Large object test", email: null } },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
  const actualSize = 2_147_483_648
  let removeCalled = false
  const storage: UploadStorage = {
    async signPut() {
      return "https://storage.invalid/unused"
    },
    async head() {
      return {
        size: actualSize,
        contentType: "application/pdf",
        etag: '"large-etag"',
      }
    },
    async remove() {
      removeCalled = true
    },
    async signGet() {
      return "https://storage.invalid/unused"
    },
  }
  const service = createUploadService(uploadRepository, storage)
  let uploadId: string | undefined
  let resumeId: string | undefined
  try {
    const intent = await service.createResumeUploadIntent(user, {
      fileName: "resume.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
    })
    uploadId = intent.uploadId
    resumeId = intent.resumeId
    await assert.rejects(
      service.reconcileResumeUpload(user, uploadId),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "upload_rejected"
    )
    const rejected = await db.resumeUpload.findUniqueOrThrow({
      where: { id: uploadId },
    })
    assert.equal(rejected.status, "rejected")
    assert.equal(rejected.actualSizeBytes, BigInt(actualSize))
    assert.equal(rejected.rejectionCode, "object_too_large")
    assert.equal(removeCalled, true)
  } finally {
    if (uploadId) {
      await db.resumeUpload.deleteMany({ where: { id: uploadId } })
    }
    if (resumeId) {
      await db.resume.deleteMany({
        where: { id: resumeId, ownerUserId: ownerId },
      })
    }
    await db.userProfile.deleteMany({ where: { id: ownerId } })
  }
})
