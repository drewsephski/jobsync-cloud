import { trialFields } from "./billing-fixtures"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createSessionContext } from "../lib/auth/session-context"
import { createOnboardingService } from "../lib/domain/onboarding/service"
import { editableContent } from "../lib/domain/onboarding/schema"
import { sanitizedResume } from "./resume-structure-fixtures"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
const { db } = await import("../lib/db")
after(() => db.$disconnect())

async function authUser(id: string) {
  return createSessionContext(
    async () => ({
      data: { user: { id, name: "Test User", email: "test@example.test" } },
      error: null,
    }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
}

async function cleanupFixtureRows(ownerId: string, otherId: string) {
  await db.resume.updateMany({
    where: { ownerUserId: ownerId },
    data: { confirmedVersionId: null, confirmedAt: null },
  })
  await db.targetPreference.deleteMany({
    where: { ownerUserId: { in: [ownerId, otherId] } },
  })
  await db.resumeVersion.deleteMany({
    where: { ownerUserId: ownerId, originDraftId: { not: null } },
  })
  await db.resumeVersion.deleteMany({ where: { ownerUserId: ownerId } })
  await db.resumeUpload.deleteMany({ where: { ownerUserId: ownerId } })
  await db.processingRun.deleteMany({ where: { ownerUserId: ownerId } })
  await db.resume.deleteMany({ where: { ownerUserId: ownerId } })
  await db.userProfile.deleteMany({
    where: { id: { in: [ownerId, otherId] } },
  })
}

async function fixture() {
  const ownerId = `onboarding-test-${randomUUID()}`
  const otherId = `onboarding-test-${randomUUID()}`
  try {
    await db.userProfile.createMany({
      data: [
        { id: ownerId, ...trialFields() },
        { id: otherId, ...trialFields() },
      ],
    })
    const user = await authUser(ownerId)
    const other = await authUser(otherId)
    const resume = await db.resume.create({
      data: { ownerUserId: ownerId, title: "Sanitized test resume" },
    })
    const uploadId = randomUUID()
    const sha256 = "a".repeat(64)
    const upload = await db.resumeUpload.create({
      data: {
        id: uploadId,
        ownerUserId: ownerId,
        resumeId: resume.id,
        objectKey: `test/${randomUUID()}`,
        originalFileName: "sanitized.docx",
        declaredContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        declaredSizeBytes: 128,
        actualContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        actualSizeBytes: BigInt(128),
        status: "uploaded",
        expiresAt: new Date(Date.now() + 60_000),
        uploadedAt: new Date(),
        validationCompletedAt: new Date(),
        detectedFormat: "docx",
        contentSha256: sha256,
      },
    })
    const run = await db.processingRun.create({
      data: {
        ownerUserId: ownerId,
        kind: "resume-structure",
        resourceId: upload.id,
        idempotencyKey: `onboarding-test-${randomUUID()}`,
        status: "succeeded",
      },
    })
    const original = await db.resumeVersion.create({
      data: {
        ownerUserId: ownerId,
        resumeId: resume.id,
        version: 1,
        source: "upload",
        status: "draft",
        sourceUploadId: upload.id,
        processingRunId: run.id,
        sourceSha256: sha256,
        extractionVersion: "test-extract-v1",
        promptVersion: "test-prompt-v1",
        schemaVersion: "resume-v1",
        data: structuredClone(sanitizedResume),
      },
    })
    const service = createOnboardingService(db)
    return {
      ownerId,
      otherId,
      user,
      other,
      resume,
      upload,
      original,
      service,
      cleanup: () => cleanupFixtureRows(ownerId, otherId),
    }
  } catch (error) {
    await cleanupFixtureRows(ownerId, otherId)
    throw error
  }
}

function editedData() {
  const data = editableContent(structuredClone(sanitizedResume))
  data.contact.phone = "312-555-0184"
  data.summary = "User-corrected summary."
  data.skills.push("Accessibility")
  data.employment[0]!.title = "Senior Software Engineer"
  data.education[0]!.field = "Computer Science"
  data.credentials[0]!.name = "User verified certificate"
  return data
}

function target(
  targetTitle: string,
  extra: Partial<{
    location: string | null
    remotePreferred: boolean | null
    minimumCompensationUsd: number | null
    keywords: string[]
  }> = {}
) {
  return {
    targetTitle,
    location: "Chicago, IL",
    remotePreferred: true,
    minimumCompensationUsd: null,
    keywords: ["TypeScript"],
    ...extra,
  }
}

function assertServiceError(expectedCode: string) {
  return (error: unknown) =>
    error instanceof Error && "code" in error && error.code === expectedCode
}

async function addAiDraft(
  f: Awaited<ReturnType<typeof fixture>>,
  options: { createdAt: Date; version: number; fileName: string }
) {
  const sha256 = randomUUID().replaceAll("-", "").padEnd(64, "b")
  const upload = await db.resumeUpload.create({
    data: {
      ownerUserId: f.ownerId,
      resumeId: f.resume.id,
      objectKey: `test/${randomUUID()}`,
      originalFileName: options.fileName,
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      declaredSizeBytes: 128,
      actualContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      actualSizeBytes: BigInt(128),
      status: "uploaded",
      expiresAt: new Date(Date.now() + 60_000),
      uploadedAt: options.createdAt,
      validationCompletedAt: options.createdAt,
      detectedFormat: "docx",
      contentSha256: sha256,
      createdAt: options.createdAt,
    },
  })
  const run = await db.processingRun.create({
    data: {
      ownerUserId: f.ownerId,
      kind: "resume-structure",
      resourceId: upload.id,
      idempotencyKey: `onboarding-test-${randomUUID()}`,
      status: "succeeded",
    },
  })
  const version = await db.resumeVersion.create({
    data: {
      ownerUserId: f.ownerId,
      resumeId: f.resume.id,
      version: options.version,
      source: "upload",
      status: "draft",
      sourceUploadId: upload.id,
      processingRunId: run.id,
      sourceSha256: sha256,
      extractionVersion: "test-extract-v1",
      promptVersion: "test-prompt-v1",
      schemaVersion: "resume-v1",
      data: structuredClone(sanitizedResume),
    },
  })
  return { upload, version }
}

test("onboarding read is tenant isolated and preserves upload progress across service instances", async () => {
  const f = await fixture()
  try {
    const firstRead = await f.service.read(f.user)
    assert.equal(firstRead.step, "review")
    assert.equal(firstRead.version?.id, f.original.id)
    assert.equal(firstRead.upload?.status, "uploaded")
    assert.deepEqual(firstRead.original?.data, sanitizedResume)
    assert.equal(
      (await createOnboardingService(db).read(f.user)).version?.id,
      f.original.id
    )
    await assert.rejects(
      f.service.save(f.other, {
        expectedVersionId: f.original.id,
        data: editedData(),
      }),
      assertServiceError("resume_not_found")
    )
    await assert.rejects(
      f.service.read(await authUser(`onboarding-missing-${randomUUID()}`)),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "P2025"
    )
  } finally {
    await f.cleanup()
  }
})

test("AI draft edits create immutable semantic versions and require explicit confirmation", async () => {
  const f = await fixture()
  try {
    const saved = await f.service.save(f.user, {
      expectedVersionId: f.original.id,
      data: editedData(),
    })
    assert.equal(saved.step, "review")
    assert.equal(saved.version?.version, 2)
    assert.equal(saved.version?.confirmed, false)
    assert.equal(saved.version?.data.contact.phone, "312-555-0184")
    assert.equal(saved.original?.id, f.original.id)
    assert.deepEqual(saved.original?.data, sanitizedResume)
    assert.equal(saved.history.length, 2)
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: f.ownerId } }),
      2
    )
    assert.equal((await f.service.read(f.user)).step, "review")
    const confirmed = await f.service.confirm(f.user, {
      expectedVersionId: saved.version!.id,
    })
    assert.equal(confirmed.step, "preferences")
    assert.equal(confirmed.version?.confirmed, true)
    assert.ok(confirmed.version?.confirmedAt)
    assert.equal(
      (await db.resume.findUniqueOrThrow({ where: { id: f.resume.id } }))
        .confirmedVersionId,
      saved.version!.id
    )
  } finally {
    await f.cleanup()
  }
})

test("concurrent edits serialize; stale edits and confirmations conflict", async () => {
  const f = await fixture()
  try {
    const results = await Promise.allSettled([
      f.service.save(f.user, {
        expectedVersionId: f.original.id,
        data: editedData(),
      }),
      f.service.save(f.user, {
        expectedVersionId: f.original.id,
        data: { ...editedData(), summary: "Second tab." },
      }),
    ])
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1)
    assert.equal(results.filter((row) => row.status === "rejected").length, 1)
    const current = await f.service.read(f.user)
    assert.equal(current.version?.version, 2)
    await assert.rejects(
      f.service.save(f.user, {
        expectedVersionId: f.original.id,
        data: editedData(),
      }),
      assertServiceError("version_conflict")
    )
    await assert.rejects(
      f.service.confirm(f.user, { expectedVersionId: f.original.id }),
      assertServiceError("version_conflict")
    )
  } finally {
    await f.cleanup()
  }
})

test("confirmation is repeatable without changing its durable timestamp", async () => {
  const f = await fixture()
  try {
    const first = await f.service.confirm(f.user, {
      expectedVersionId: f.original.id,
    })
    const confirmedAt = first.version?.confirmedAt
    const second = await f.service.confirm(f.user, {
      expectedVersionId: f.original.id,
    })
    assert.equal(second.step, "preferences")
    assert.equal(second.version?.confirmedAt, confirmedAt)
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: f.ownerId } }),
      1
    )
  } finally {
    await f.cleanup()
  }
})

test("preferences require a confirmed current version, support multiple roles, and complete once", async () => {
  const f = await fixture()
  try {
    await assert.rejects(
      f.service.preferences(f.user, {
        expectedVersionId: f.original.id,
        expectedRevision: 0,
        targets: [target("Engineer")],
        complete: true,
      }),
      assertServiceError("resume_not_confirmed")
    )
    await f.service.confirm(f.user, { expectedVersionId: f.original.id })
    const saved = await f.service.preferences(f.user, {
      expectedVersionId: f.original.id,
      expectedRevision: 0,
      targets: [
        target("Backend Engineer", { minimumCompensationUsd: 150000 }),
        target("Platform Engineer", {
          location: "Remote",
          keywords: ["Kubernetes", "AWS"],
        }),
      ],
      complete: false,
    })
    assert.equal(saved.step, "preferences")
    assert.equal(saved.preferenceRevision, 1)
    assert.equal(saved.targets.length, 2)
    assert.equal(
      (await createOnboardingService(db).read(f.user)).targets[1]?.targetTitle,
      "Platform Engineer"
    )
    await assert.rejects(
      f.service.preferences(f.user, {
        expectedVersionId: f.original.id,
        expectedRevision: 0,
        targets: [target("Stale target")],
        complete: false,
      }),
      assertServiceError("preferences_conflict")
    )
    const completed = await f.service.preferences(f.user, {
      expectedVersionId: f.original.id,
      expectedRevision: 1,
      targets: saved.targets.map((row) => ({
        ...row,
        minimumCompensationUsd: row.minimumCompensationUsd,
      })),
      complete: true,
    })
    assert.equal(completed.step, "complete")
    assert.ok(completed.completedAt)
    const completionTime = completed.completedAt
    const repeated = await f.service.preferences(f.user, {
      expectedVersionId: f.original.id,
      expectedRevision: 0,
      targets: [target("Ignored repeated submission")],
      complete: true,
    })
    assert.equal(repeated.completedAt, completionTime)
    assert.equal(repeated.preferenceRevision, 2)
    assert.deepEqual(repeated.targets.map((row) => row.targetTitle).sort(), [
      "Backend Engineer",
      "Platform Engineer",
    ])
  } finally {
    await f.cleanup()
  }
})

test("a newer upload makes the previous draft stale without discarding its history", async () => {
  const f = await fixture()
  try {
    await db.resumeUpload.create({
      data: {
        ownerUserId: f.ownerId,
        resumeId: f.resume.id,
        objectKey: `test/${randomUUID()}`,
        originalFileName: "newer.docx",
        declaredContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        declaredSizeBytes: 128,
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() + 2_000),
      },
    })
    const state = await f.service.read(f.user)
    assert.equal(state.step, "processing")
    assert.equal(state.version, null)
    assert.equal(state.history.length, 1)
    await assert.rejects(
      f.service.save(f.user, {
        expectedVersionId: f.original.id,
        data: editedData(),
      }),
      assertServiceError("version_conflict")
    )
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: f.ownerId } }),
      1
    )
  } finally {
    await f.cleanup()
  }
})

test("foreign resume versions cannot be confirmed or used to write preferences", async () => {
  const f = await fixture()
  try {
    const foreignResume = await db.resume.create({
      data: { ownerUserId: f.otherId, title: "Other user's resume" },
    })
    const foreignVersion = await db.resumeVersion.create({
      data: {
        ownerUserId: f.otherId,
        resumeId: foreignResume.id,
        version: 1,
        source: "manual",
        data: editableContent(structuredClone(sanitizedResume)),
      },
    })
    await assert.rejects(
      f.service.confirm(f.user, { expectedVersionId: foreignVersion.id }),
      assertServiceError("resume_not_found")
    )
    await assert.rejects(
      f.service.preferences(f.user, {
        expectedVersionId: foreignVersion.id,
        expectedRevision: 0,
        targets: [target("Engineer")],
        complete: true,
      }),
      assertServiceError("resume_not_found")
    )
    assert.equal(
      await db.targetPreference.count({ where: { ownerUserId: f.ownerId } }),
      0
    )
  } finally {
    await db.resumeVersion.deleteMany({ where: { ownerUserId: f.otherId } })
    await db.resume.deleteMany({ where: { ownerUserId: f.otherId } })
    await f.cleanup()
  }
})

test("strict inputs reject forged owner fields", async () => {
  const f = await fixture()
  try {
    assert.throws(
      () =>
        f.service.save(f.user, {
          ownerUserId: f.otherId,
          expectedVersionId: f.original.id,
          data: editedData(),
        }),
      assertServiceError("invalid_input")
    )
    assert.throws(
      () =>
        f.service.confirm(f.user, {
          ownerUserId: f.otherId,
          expectedVersionId: f.original.id,
        }),
      assertServiceError("invalid_input")
    )
    assert.throws(
      () =>
        f.service.preferences(f.user, {
          ownerUserId: f.otherId,
          expectedVersionId: f.original.id,
          expectedRevision: 0,
          targets: [target("Engineer")],
          complete: true,
        }),
      assertServiceError("invalid_input")
    )
  } finally {
    await f.cleanup()
  }
})

test("editing accepted resume preserves consent until the new version is reconfirmed", async () => {
  const f = await fixture()
  try {
    const confirmed = await f.service.confirm(f.user, {
      expectedVersionId: f.original.id,
    })
    const acceptedAt = confirmed.version?.confirmedAt
    const accepted = await f.service.save(f.user, {
      expectedVersionId: f.original.id,
      data: editedData(),
    })
    assert.equal(accepted.version?.version, 2)
    assert.equal(accepted.version?.confirmed, false)
    assert.equal(accepted.step, "review")
    assert.equal(
      (await db.resume.findUniqueOrThrow({ where: { id: f.resume.id } }))
        .confirmedVersionId,
      f.original.id
    )
    assert.equal(
      (
        await db.resume.findUniqueOrThrow({ where: { id: f.resume.id } })
      ).confirmedAt?.toISOString(),
      acceptedAt
    )
    const reconfirmed = await f.service.confirm(f.user, {
      expectedVersionId: accepted.version!.id,
    })
    assert.equal(reconfirmed.version?.confirmed, true)
    assert.equal(reconfirmed.step, "preferences")
    assert.equal(
      (await db.resume.findUniqueOrThrow({ where: { id: f.resume.id } }))
        .confirmedVersionId,
      accepted.version!.id
    )
  } finally {
    await f.cleanup()
  }
})

test("saving unchanged content is a no-op and blank names cannot be confirmed", async () => {
  const f = await fixture()
  try {
    const unchanged = await f.service.save(f.user, {
      expectedVersionId: f.original.id,
      data: editableContent(structuredClone(sanitizedResume)),
    })
    assert.equal(unchanged.version?.id, f.original.id)
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: f.ownerId } }),
      1
    )
    const blankName = editedData()
    blankName.contact.name = "   "
    const saved = await f.service.save(f.user, {
      expectedVersionId: f.original.id,
      data: blankName,
    })
    await assert.rejects(
      f.service.confirm(f.user, { expectedVersionId: saved.version!.id }),
      assertServiceError("resume_incomplete")
    )
  } finally {
    await f.cleanup()
  }
})

test("late AI completion keeps latest upload lineage and new edits use global version order", async () => {
  const f = await fixture()
  try {
    const baseTime = f.upload.createdAt
    const newer = await addAiDraft(f, {
      createdAt: new Date(baseTime.getTime() + 2_000),
      version: 2,
      fileName: "newest.docx",
    })
    const lateOlderCompletion = await addAiDraft(f, {
      createdAt: new Date(baseTime.getTime() + 1_000),
      version: 3,
      fileName: "older-upload.docx",
    })
    const state = await f.service.read(f.user)
    assert.equal(state.upload?.id, newer.upload.id)
    assert.equal(state.version?.id, newer.version.id)
    assert.equal(state.original?.id, newer.version.id)
    assert.ok(
      state.history.some((row) => row.id === lateOlderCompletion.version.id)
    )
    const edited = await f.service.save(f.user, {
      expectedVersionId: newer.version.id,
      data: editedData(),
    })
    assert.equal(edited.version?.version, 4)
    assert.equal(edited.original?.id, newer.version.id)
    assert.equal(
      edited.version?.id,
      (
        await db.resumeVersion.findFirstOrThrow({
          where: { id: edited.version!.id },
        })
      ).id
    )
  } finally {
    await f.cleanup()
  }
})

test("NO KEY UPDATE profile locking lets the worker insert an AI version while it owns the resume lock", async () => {
  const f = await fixture()
  let releaseProfile!: () => void
  let markProfileLocked!: () => void
  const profileRelease = new Promise<void>((resolve) => {
    releaseProfile = resolve
  })
  const profileLocked = new Promise<void>((resolve) => {
    markProfileLocked = resolve
  })
  let profileTransaction: Promise<void> | undefined
  try {
    const sha256 = "b".repeat(64)
    const upload = await db.resumeUpload.create({
      data: {
        ownerUserId: f.ownerId,
        resumeId: f.resume.id,
        objectKey: `test/${randomUUID()}`,
        originalFileName: "worker-output.docx",
        declaredContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        declaredSizeBytes: 128,
        actualContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        actualSizeBytes: BigInt(128),
        status: "uploaded",
        expiresAt: new Date(Date.now() + 60_000),
        uploadedAt: new Date(),
        validationCompletedAt: new Date(),
        detectedFormat: "docx",
        contentSha256: sha256,
        createdAt: new Date(Date.now() + 2_000),
      },
    })
    const run = await db.processingRun.create({
      data: {
        ownerUserId: f.ownerId,
        kind: "resume-structure",
        resourceId: upload.id,
        idempotencyKey: `onboarding-test-${randomUUID()}`,
        status: "succeeded",
      },
    })
    profileTransaction = db.$transaction(async (tx) => {
      await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "UserProfile" WHERE id = ${f.ownerId} FOR NO KEY UPDATE`
      markProfileLocked()
      await profileRelease
    })
    await Promise.race([
      profileLocked,
      profileTransaction.then(() => {
        throw new Error(
          "Profile transaction ended before its lock was released"
        )
      }),
    ])

    const versionId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '4s'`
      await tx.$queryRaw`SELECT id FROM "Resume" WHERE id = ${f.resume.id}::uuid AND "ownerUserId" = ${f.ownerId} FOR UPDATE`
      return (
        await tx.resumeVersion.create({
          data: {
            ownerUserId: f.ownerId,
            resumeId: f.resume.id,
            version: 2,
            source: "upload",
            status: "draft",
            sourceUploadId: upload.id,
            processingRunId: run.id,
            sourceSha256: sha256,
            extractionVersion: "test-extract-v1",
            promptVersion: "test-prompt-v1",
            schemaVersion: "resume-v1",
            data: structuredClone(sanitizedResume),
          },
          select: { id: true },
        })
      ).id
    })
    assert.match(versionId, /^[0-9a-f-]{36}$/i)
    assert.equal(
      await db.resumeVersion.count({
        where: { ownerUserId: f.ownerId, version: 2 },
      }),
      1
    )
  } finally {
    releaseProfile()
    await profileTransaction?.catch(() => undefined)
    await f.cleanup()
  }
})
