import { trialFields } from "./billing-fixtures"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createSessionContext } from "../lib/auth/session-context"
import { createApplicationService } from "../lib/domain/applications/service"
import { UploadError } from "../lib/domain/resume-upload/service"
import { calendarToday, dateSchema } from "../lib/domain/applications/schema"
import { sanitizedResume } from "./resume-structure-fixtures"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
const { db } = await import("../lib/db")
after(() => db.$disconnect())

const service = createApplicationService(db)
const tomorrow = new Date(
  new Date(`${calendarToday("America/Los_Angeles")}T00:00:00Z`).getTime() +
    86_400_000
)
  .toISOString()
  .slice(0, 10)
test("calendar dates respect the profile timezone and reject impossible dates", () => {
  const instant = new Date("2026-10-01T01:00:00Z")
  assert.equal(calendarToday("America/Los_Angeles", instant), "2026-09-30")
  assert.equal(calendarToday("UTC", instant), "2026-10-01")
  assert.equal(calendarToday("unknown", instant), "2026-10-01")
  assert.equal(dateSchema.safeParse("2026-02-30").success, false)
  assert.equal(dateSchema.safeParse("2028-02-29").success, true)
})
async function authUser(id: string) {
  return createSessionContext(
    async () => ({ data: { user: { id } }, error: null }),
    () => {
      throw new Error("Unexpected redirect")
    }
  ).requireCurrentAuthUser()
}
const details = (resumeVersionId: string | null = null) => ({
  company: "  Example Co  ",
  title: "  Staff Engineer  ",
  location: "Remote",
  postingUrl: "https://jobs.example.test/role",
  salary: null,
  notes: "first note",
  appliedOn: null,
  followUpOn: null,
  nextAction: "Prepare materials",
  resumeVersionId,
})
async function fixture() {
  const ids = {
    owner: `applications-${randomUUID()}`,
    other: `applications-${randomUUID()}`,
  }
  let companyId: string | undefined,
    boardId: string | undefined,
    postingId: string | undefined
  await db.userProfile.createMany({
    data: [
      {
        id: ids.owner,
        ...trialFields(),
        timezone: "America/Los_Angeles",
        onboardingCompletedAt: new Date(),
      },
      { id: ids.other, ...trialFields(), onboardingCompletedAt: new Date() },
    ],
  })
  try {
    const company = await db.company.create({
      data: {
        name: "Application Fixture",
        slug: `application-${randomUUID()}`,
      },
    })
    companyId = company.id
    const board = await db.atsBoard.create({
      data: {
        companyId,
        provider: "greenhouse",
        slug: `application-${randomUUID()}`,
      },
    })
    boardId = board.id
    const posting = await db.jobPosting.create({
      data: {
        boardId,
        externalId: `role-${randomUUID()}`,
        title: "Platform Engineer",
        location: "Seattle, WA",
        remote: true,
        description: "Build resilient services.",
        originalUrl: "https://boards.example.test/role",
        contentHash: "a".repeat(64),
      },
    })
    postingId = posting.id
    const resume = await db.resume.create({
      data: { ownerUserId: ids.owner, title: "Confirmed resume" },
    })
    const version = await db.resumeVersion.create({
      data: {
        ownerUserId: ids.owner,
        resumeId: resume.id,
        version: 1,
        source: "manual",
        status: "ready",
        data: sanitizedResume,
      },
    })
    await db.resume.update({
      where: { id: resume.id },
      data: { confirmedVersionId: version.id, confirmedAt: new Date() },
    })
    const match = await db.jobMatch.create({
      data: {
        ownerUserId: ids.owner,
        resumeId: resume.id,
        resumeVersionId: version.id,
        preferenceRevision: 3,
        preferenceHash: "b".repeat(64),
        jobPostingId: posting.id,
        postingVersion: 1,
        postingHash: posting.contentHash,
        algorithmVersion: "test-v1",
        inputKey: `applications:${randomUUID()}`,
        relevance: 85,
        reasons: ["Relevant title"],
        aiScore: 91,
        recommendation: "strong",
        rationale: "The experience aligns.",
        aiAnalyzedAt: new Date(),
      },
    })
    const otherResume = await db.resume.create({
      data: { ownerUserId: ids.other, title: "Other confirmed resume" },
    })
    const otherVersion = await db.resumeVersion.create({
      data: {
        ownerUserId: ids.other,
        resumeId: otherResume.id,
        version: 1,
        source: "manual",
        status: "ready",
        data: sanitizedResume,
      },
    })
    await db.resume.update({
      where: { id: otherResume.id },
      data: { confirmedVersionId: otherVersion.id, confirmedAt: new Date() },
    })
    return {
      ids,
      owner: await authUser(ids.owner),
      other: await authUser(ids.other),
      companyId,
      boardId,
      postingId,
      resumeId: resume.id,
      versionId: version.id,
      matchId: match.id,
      otherResumeId: otherResume.id,
      otherVersionId: otherVersion.id,
    }
  } catch (error) {
    if (postingId) await db.jobPosting.deleteMany({ where: { id: postingId } })
    if (boardId) await db.atsBoard.deleteMany({ where: { id: boardId } })
    if (companyId) await db.company.deleteMany({ where: { id: companyId } })
    await db.userProfile.deleteMany({
      where: { id: { in: Object.values(ids) } },
    })
    throw error
  }
}
async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await db.application.deleteMany({
    where: { ownerUserId: { in: [f.ids.owner, f.ids.other] } },
  })
  await db.jobMatch.deleteMany({
    where: { ownerUserId: { in: [f.ids.owner, f.ids.other] } },
  })
  await db.resume.updateMany({
    where: { ownerUserId: { in: [f.ids.owner, f.ids.other] } },
    data: { confirmedVersionId: null, confirmedAt: null },
  })
  await db.resumeVersion.deleteMany({
    where: { ownerUserId: { in: [f.ids.owner, f.ids.other] } },
  })
  await db.resume.deleteMany({
    where: { ownerUserId: { in: [f.ids.owner, f.ids.other] } },
  })
  await db.userProfile.deleteMany({
    where: { id: { in: [f.ids.owner, f.ids.other] } },
  })
  if (f.postingId)
    await db.jobPosting.deleteMany({ where: { id: f.postingId } })
  if (f.boardId) await db.atsBoard.deleteMany({ where: { id: f.boardId } })
  if (f.companyId) await db.company.deleteMany({ where: { id: f.companyId } })
}
const expectError = async (
  promise: Promise<unknown>,
  code: string,
  status?: number
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof UploadError)
    assert.equal(error.code, code)
    if (status) assert.equal(error.status, status)
    return true
  })
}

test("real Postgres: private applications, conversion idempotency, history and snapshots", async () => {
  const f = await fixture()
  try {
    const request = {
      action: "track",
      postingId: f.postingId,
      matchId: f.matchId,
    } as const
    const converted = await Promise.all(
      Array.from({ length: 10 }, () => service.mutate(f.owner, request))
    )
    assert.equal(converted.filter((result) => result.created).length, 1)
    assert.equal(
      new Set(converted.map((result) => result.applicationId)).size,
      1
    )
    const applicationId = converted[0]!.applicationId
    const app = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { events: true },
    })
    assert.equal(app.ownerUserId, f.ids.owner)
    assert.equal(app.status, "saved")
    assert.equal(app.company, "Application Fixture")
    assert.equal(app.title, "Platform Engineer")
    assert.equal((app.sourceSnapshot as { kind: string }).kind, "discover")
    assert.equal(
      (
        app.sourceSnapshot as {
          match: { id: string; inputKey: string; aiScore: number }
        }
      ).match.id,
      f.matchId
    )
    assert.equal(
      (app.sourceSnapshot as { match: { inputKey: string } }).match.inputKey,
      (await db.jobMatch.findUniqueOrThrow({ where: { id: f.matchId } }))
        .inputKey
    )
    assert.equal(
      (app.sourceSnapshot as { posting: { contentHash: string } }).posting
        .contentHash,
      "a".repeat(64)
    )
    assert.equal(app.events.length, 1)
    assert.equal(
      app.events[0]!.occurredOn.toISOString().slice(0, 10),
      (await service.read(f.owner)).today
    )
    await assert.rejects(
      db.application.update({
        where: { id: app.id },
        data: { sourceSnapshot: { kind: "forged" } },
      })
    )
    await assert.rejects(
      db.applicationEvent.create({
        data: {
          ownerUserId: f.ids.other,
          applicationId: app.id,
          revision: 1,
          kind: "transition",
          fromStatus: "saved",
          toStatus: "applied",
          occurredOn: new Date("2026-09-29T00:00:00Z"),
        },
      })
    )

    const second = await fixtureManual(f)
    assert.equal(second.ownerUserId, f.ids.owner)
    assert.equal(second.appliedOn?.toISOString().slice(0, 10), "2026-09-25")
    assert.equal(second.followUpOn?.toISOString().slice(0, 10), tomorrow)
    assert.equal(second.resumeId, f.resumeId)
    assert.deepEqual(second.resumeSnapshot, {
      title: "Confirmed resume",
      version: 1,
      confirmedAt: (
        await db.resume.findUniqueOrThrow({ where: { id: f.resumeId } })
      ).confirmedAt!.toISOString(),
    })
    assert.equal(
      (
        await db.applicationEvent.findFirstOrThrow({
          where: { applicationId: second.id },
        })
      ).occurredOn
        .toISOString()
        .slice(0, 10),
      (await service.read(f.owner)).today
    )
    // Calendar application date remains historical and independent of today's event date.
    assert.equal(second.appliedOn!.toISOString().slice(0, 10), "2026-09-25")
    const sameKey = await service.mutate(f.owner, {
      action: "create",
      creationKey: manualKey,
      details: {
        ...details(f.versionId),
        appliedOn: "2026-09-25",
        followUpOn: tomorrow,
      },
      status: "applied",
      stageName: null,
    })
    assert.equal(sameKey.created, false)
    assert.equal(sameKey.applicationId, second.id)
    await expectError(
      service.mutate(f.owner, {
        action: "create",
        creationKey: randomUUID(),
        details: details(),
        status: "applied",
        stageName: null,
      }),
      "application_date_required",
      400
    )
    await expectError(
      service.mutate(f.owner, {
        action: "create",
        creationKey: randomUUID(),
        details: { ...details(), appliedOn: "2999-01-01" },
        status: "applied",
        stageName: null,
      }),
      "future_application_date",
      400
    )
    await expectError(
      service.mutate(f.owner, {
        action: "edit",
        applicationId: second.id,
        expectedRevision: 0,
        details: { ...details(f.versionId), appliedOn: "2999-01-01" },
      }),
      "future_application_date",
      400
    )
    await expectError(
      service.mutate(f.owner, {
        action: "create",
        creationKey: randomUUID(),
        details: { ...details(f.otherVersionId), appliedOn: "2026-09-25" },
        status: "applied",
        stageName: null,
      }),
      "resume_not_confirmed",
      409
    )

    // Only explicitly confirmed resume versions are offered; old confirmed versions remain valid.
    const newerResume = await db.resume.create({
      data: { ownerUserId: f.ids.owner, title: "New confirmed resume" },
    })
    const newerVersion = await db.resumeVersion.create({
      data: {
        ownerUserId: f.ids.owner,
        resumeId: newerResume.id,
        version: 1,
        source: "manual",
        status: "ready",
        data: sanitizedResume,
      },
    })
    await db.resume.update({
      where: { id: newerResume.id },
      data: { confirmedVersionId: newerVersion.id, confirmedAt: new Date() },
    })
    const availableResumes = await service.read(f.owner)
    assert.deepEqual(
      new Set(availableResumes.resumes.map((resume) => resume.id)),
      new Set([f.versionId, newerVersion.id])
    )
    const heldNewResume = await service.mutate(f.owner, {
      action: "create",
      creationKey: randomUUID(),
      details: { ...details(newerVersion.id), appliedOn: "2026-09-25" },
      status: "applied",
      stageName: null,
    })
    const newResumeApp = await db.application.findUniqueOrThrow({
      where: { id: heldNewResume.applicationId },
    })
    assert.deepEqual(newResumeApp.resumeSnapshot, {
      title: "New confirmed resume",
      version: 1,
      confirmedAt: (
        await db.resume.findUniqueOrThrow({ where: { id: newerResume.id } })
      ).confirmedAt!.toISOString(),
    })
    const unconfirmedDraft = await db.resumeVersion.create({
      data: {
        ownerUserId: f.ids.owner,
        resumeId: f.resumeId,
        version: 2,
        source: "manual",
        status: "draft",
        data: sanitizedResume,
      },
    })
    await expectError(
      service.mutate(f.owner, {
        action: "create",
        creationKey: randomUUID(),
        details: { ...details(unconfirmedDraft.id), appliedOn: "2026-09-25" },
        status: "applied",
        stageName: null,
      }),
      "resume_not_confirmed",
      409
    )

    const reconfirmed = await db.resumeVersion.create({
      data: {
        ownerUserId: f.ids.owner,
        resumeId: f.resumeId,
        version: 3,
        source: "manual",
        status: "ready",
        data: sanitizedResume,
      },
    })
    await db.resume.update({
      where: { id: f.resumeId },
      data: { confirmedVersionId: reconfirmed.id, confirmedAt: new Date() },
    })
    await service.mutate(f.owner, {
      action: "edit",
      applicationId: second.id,
      expectedRevision: 0,
      details: {
        ...details(f.versionId),
        appliedOn: "2026-09-25",
        followUpOn: tomorrow,
        notes: "Previous submitted version retained",
      },
    })
    const retainedResume = await db.application.findUniqueOrThrow({
      where: { id: second.id },
    })
    assert.equal(retainedResume.resumeVersionId, f.versionId)
    assert.deepEqual(retainedResume.resumeSnapshot, second.resumeSnapshot)
    await expectError(
      service.mutate(f.owner, {
        action: "create",
        creationKey: randomUUID(),
        details: details(f.versionId),
        status: "saved",
        stageName: null,
      }),
      "resume_not_confirmed",
      409
    )

    const otherRequest = await service.mutate(f.other, request).catch((e) => e)
    assert.ok(otherRequest instanceof UploadError)
    assert.equal(otherRequest.code, "job_not_found")
    await expectError(
      service.mutate(f.other, {
        action: "edit",
        applicationId,
        expectedRevision: 0,
        details: details(),
      }),
      "application_not_found",
      404
    )
    await expectError(
      service.mutate(f.other, {
        action: "archive",
        applicationId,
        expectedRevision: 0,
        archived: true,
      }),
      "application_not_found",
      404
    )
    await expectError(
      service.mutate(f.other, {
        action: "delete",
        applicationId,
        expectedRevision: 0,
      }),
      "application_not_found",
      404
    )
    assert.equal(
      await db.application.count({ where: { ownerUserId: f.ids.other } }),
      0
    )

    // A second owner may independently track a shared posting only through their own match.
    const otherMatch = await db.jobMatch.create({
      data: {
        ownerUserId: f.ids.other,
        resumeId: f.otherResumeId,
        resumeVersionId: f.otherVersionId,
        preferenceRevision: 1,
        preferenceHash: "d".repeat(64),
        jobPostingId: f.postingId!,
        postingVersion: 1,
        postingHash: "a".repeat(64),
        algorithmVersion: "test-v1",
        inputKey: `other:${randomUUID()}`,
        relevance: 70,
        reasons: ["Other private input"],
      },
    })
    const otherTracked = await service.mutate(f.other, {
      action: "track",
      postingId: f.postingId,
      matchId: otherMatch.id,
    })
    assert.equal(otherTracked.created, true)
    await expectError(
      service.mutate(f.owner, {
        action: "edit",
        applicationId: otherTracked.applicationId,
        expectedRevision: 0,
        details: details(),
      }),
      "application_not_found",
      404
    )
    assert.equal(
      (await service.read(f.owner)).applications.some(
        (row) => row.id === otherTracked.applicationId
      ),
      false
    )
    assert.equal(
      (await service.read(f.other)).applications.some(
        (row) => row.id === otherTracked.applicationId
      ),
      true
    )

    // Revision CAS permits one concurrent edit/transition; the loser must reload.
    const races = await Promise.allSettled([
      service.mutate(f.owner, {
        action: "edit",
        applicationId,
        expectedRevision: 0,
        details: { ...details(), notes: "edited" },
      }),
      service.mutate(f.owner, {
        action: "transition",
        applicationId,
        expectedRevision: 0,
        status: "applied",
        stageName: null,
        occurredOn: "2026-09-29",
        note: "Submitted",
      }),
    ])
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1)
    const rejected = races.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult
    assert.ok(rejected.reason instanceof UploadError)
    assert.equal(rejected.reason.code, "application_conflict")
    const afterRace = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { events: { orderBy: { revision: "asc" } } },
    })
    assert.equal(afterRace.revision, 1)
    assert.equal(
      afterRace.events.length,
      1 + Number(afterRace.status === "applied")
    )
    if (afterRace.status === "applied")
      assert.equal(
        afterRace.appliedOn?.toISOString().slice(0, 10),
        "2026-09-29"
      )
    if (afterRace.events.length > 1) {
      await assert.rejects(
        db.applicationEvent.update({
          where: { id: afterRace.events[1]!.id },
          data: { note: "rewrite" },
        })
      )
    }
    await expectError(
      service.mutate(f.owner, {
        action: "transition",
        applicationId,
        expectedRevision: afterRace.revision,
        status: "interview",
        stageName: "Panel",
        occurredOn: "2999-01-01",
        note: null,
      }),
      "future_transition",
      400
    )
    await expectError(
      service.mutate(f.owner, {
        action: "edit",
        applicationId,
        expectedRevision: afterRace.revision - 1,
        details: details(),
      }),
      "application_conflict",
      409
    )

    // The source snapshot stays intact across catalog updates, soft closure, and deletion.
    await db.jobPosting.update({
      where: { id: f.postingId },
      data: {
        title: "Renamed role",
        contentVersion: 2,
        contentHash: "c".repeat(64),
        open: false,
        closedAt: new Date(),
      },
    })
    const beforeDelete = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
    })
    assert.equal(
      beforeDelete.title,
      afterRace.status === "applied" ? "Platform Engineer" : "Staff Engineer"
    )
    assert.equal(
      (beforeDelete.sourceSnapshot as { posting: { title: string } }).posting
        .title,
      "Platform Engineer"
    )
    // Archive first, then delete; retracking the same source creates a fresh record.
    const current = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
    })
    await expectError(
      service.mutate(f.owner, {
        action: "delete",
        applicationId,
        expectedRevision: current.revision,
      }),
      "archive_before_delete",
      409
    )
    await service.mutate(f.owner, {
      action: "archive",
      applicationId,
      expectedRevision: current.revision,
      archived: true,
    })
    const archived = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
    })
    const duplicateWhileArchived = await service.mutate(f.owner, request)
    assert.equal(duplicateWhileArchived.created, false)
    assert.equal(duplicateWhileArchived.applicationId, applicationId)
    const restored = await service.mutate(f.owner, {
      action: "archive",
      applicationId,
      expectedRevision: archived.revision,
      archived: false,
    })
    assert.equal(restored.changed, true)
    const restoredRow = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
    })
    const repeatedRestore = await service.mutate(f.owner, {
      action: "archive",
      applicationId,
      expectedRevision: restoredRow.revision,
      archived: false,
    })
    assert.equal(repeatedRestore.changed, false)
    const rearchived = await service.mutate(f.owner, {
      action: "archive",
      applicationId,
      expectedRevision: restoredRow.revision,
      archived: true,
    })
    assert.equal(rearchived.changed, true)
    const finalArchived = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
    })
    await service.mutate(f.owner, {
      action: "delete",
      applicationId,
      expectedRevision: finalArchived.revision,
    })
    assert.equal(
      await db.application.findUnique({ where: { id: applicationId } }),
      null
    )
    assert.equal(
      await db.applicationEvent.count({ where: { applicationId } }),
      0
    )
    const retracked = await service.mutate(f.owner, request)
    assert.equal(retracked.created, true)
    assert.notEqual(retracked.applicationId, applicationId)
    // Retracking after delete creates a fresh snapshot of the then-current posting.
    const snapshotRow = await db.application.findUniqueOrThrow({
      where: { id: retracked.applicationId },
    })
    assert.equal(snapshotRow.title, "Renamed role")
    assert.equal(
      (snapshotRow.sourceSnapshot as { posting: { title: string } }).posting
        .title,
      "Renamed role"
    )
    await db.jobMatch.deleteMany({ where: { jobPostingId: f.postingId } })
    await db.jobPosting.delete({ where: { id: f.postingId } })
    const afterDelete = await db.application.findUniqueOrThrow({
      where: { id: retracked.applicationId },
    })
    assert.equal(afterDelete.jobPostingId, null)
    assert.deepEqual(afterDelete.sourceSnapshot, snapshotRow.sourceSnapshot)

    // Status moves append once; a same-stage retry is a no-op, and a technical
    // interview stage edit within the same status creates a new event.
    const progression = await service.mutate(f.owner, {
      action: "create",
      creationKey: randomUUID(),
      details: { ...details(), appliedOn: "2026-09-25" },
      status: "applied",
      stageName: null,
    })
    const moveToInterview = await service.mutate(f.owner, {
      action: "transition",
      applicationId: progression.applicationId,
      expectedRevision: 0,
      status: "interview",
      stageName: "Technical screen",
      occurredOn: "2026-09-29",
      note: "Invite received",
    })
    assert.equal(moveToInterview.changed, true)
    const sameStage = await service.mutate(f.owner, {
      action: "transition",
      applicationId: progression.applicationId,
      expectedRevision: 1,
      status: "interview",
      stageName: "Technical screen",
      occurredOn: "2026-09-29",
      note: null,
    })
    assert.equal(sameStage.changed, false)
    const differentTechnicalStage = await service.mutate(f.owner, {
      action: "transition",
      applicationId: progression.applicationId,
      expectedRevision: 1,
      status: "interview",
      stageName: "Technical interview",
      occurredOn: "2026-09-30",
      note: "Deep dive",
    })
    assert.equal(differentTechnicalStage.changed, true)
    const progressionRow = await db.application.findUniqueOrThrow({
      where: { id: progression.applicationId },
      include: { events: { orderBy: { revision: "asc" } } },
    })
    assert.equal(progressionRow.status, "interview")
    assert.equal(progressionRow.revision, 2)
    assert.deepEqual(
      progressionRow.events.map((event) => [
        event.kind,
        event.toStatus,
        event.stageName,
      ]),
      [
        ["created", "applied", null],
        ["transition", "interview", "Technical screen"],
        ["transition", "interview", "Technical interview"],
      ]
    )
    await service.mutate(f.owner, {
      action: "archive",
      applicationId: progression.applicationId,
      expectedRevision: 2,
      archived: true,
    })
    const archivedProgression = await db.application.findUniqueOrThrow({
      where: { id: progression.applicationId },
    })
    await service.mutate(f.owner, {
      action: "delete",
      applicationId: progression.applicationId,
      expectedRevision: archivedProgression.revision,
    })

    // Dashboard counts and activity reflect explicit records/events only.
    const dueApp = await service.mutate(f.owner, {
      action: "create",
      creationKey: randomUUID(),
      details: { ...details(), followUpOn: "2026-09-20" },
      status: "saved",
      stageName: null,
    })
    assert.equal(dueApp.created, true)
    const finalDashboard = await service.dashboard(f.owner)
    assert.equal(finalDashboard.activeCount, 4)
    assert.equal(finalDashboard.appliedCount, 2)
    assert.equal(finalDashboard.dueCount, 1)
    assert.equal(finalDashboard.due[0]!.id, dueApp.applicationId)
    assert.ok(finalDashboard.upcoming.some((item) => item.id === second.id))
    assert.equal(finalDashboard.preparing.length, 2)
    assert.ok(
      finalDashboard.due.every(
        (item) => item.followUpOn && item.followUpOn <= finalDashboard.today
      )
    )
    assert.ok(finalDashboard.preparing.every((item) => item.status === "saved"))
    assert.deepEqual(
      new Set(finalDashboard.recent.map((event) => event.applicationId)),
      new Set([
        second.id,
        retracked.applicationId,
        dueApp.applicationId,
        heldNewResume.applicationId,
      ])
    )
  } finally {
    await cleanup(f)
  }
})

const manualKey = randomUUID()
async function fixtureManual(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await service.mutate(f.owner, {
    action: "create",
    creationKey: manualKey,
    details: {
      ...details(f.versionId),
      appliedOn: "2026-09-25",
      followUpOn: tomorrow,
    },
    status: "applied",
    stageName: null,
  })
  assert.equal(result.created, true)
  return db.application.findUniqueOrThrow({
    where: { id: result.applicationId },
  })
}
