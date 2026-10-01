import { requireCoreEntitlement } from "../../billing/entitlements"
import { randomUUID } from "node:crypto"
import type { PrismaClient, Prisma } from "../../generated/prisma/client"
import type { CurrentAuthUser } from "../../auth/session-context"
import { UploadError } from "../resume-upload/service"
import {
  applicationMutationSchema,
  activeStatuses,
  calendarToday,
  type ApplicationDetails,
} from "./schema"
const date = (value: string | null) =>
  value ? new Date(`${value}T00:00:00Z`) : null
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null
const applicationInclude = {
  posting: { select: { open: true, contentHash: true } },
  events: { orderBy: { revision: "desc" as const } },
} satisfies Prisma.ApplicationInclude
function view(
  application: Prisma.ApplicationGetPayload<{
    include: typeof applicationInclude
  }>
) {
  return {
    ...application,
    appliedOn: day(application.appliedOn),
    followUpOn: day(application.followUpOn),
    archivedAt: application.archivedAt?.toISOString() ?? null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    events: application.events.map((e) => ({
      ...e,
      occurredOn: day(e.occurredOn)!,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}
export type ApplicationView = ReturnType<typeof view>
export type ApplicationsData = Awaited<
  ReturnType<ReturnType<typeof createApplicationService>["read"]>
>
export type ApplicationDashboard = Awaited<
  ReturnType<ReturnType<typeof createApplicationService>["dashboard"]>
>
export function createApplicationService(db: PrismaClient) {
  async function confirmedResumes(
    tx: Prisma.TransactionClient,
    ownerUserId: string
  ) {
    return tx.resume.findMany({
      where: {
        ownerUserId,
        confirmedVersionId: { not: null },
        confirmedAt: { not: null },
        confirmedVersion: { status: "ready" },
      },
      include: { confirmedVersion: true },
      orderBy: { confirmedAt: "desc" },
    })
  }
  async function read(user: CurrentAuthUser) {
    return db.$transaction(
      async (tx) => {
        const profile = await tx.userProfile.findUniqueOrThrow({
          where: { id: user.id },
        })
        const applications = await tx.application.findMany({
          where: { ownerUserId: user.id },
          include: applicationInclude,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        })
        const resumes = await confirmedResumes(tx, user.id)
        return {
          applications: applications.map(view),
          today: calendarToday(profile.timezone ?? "UTC"),
          resumes: resumes.map((r) => ({
            id: r.confirmedVersion!.id,
            label: `${r.title} · v${r.confirmedVersion!.version}`,
          })),
        }
      },
      { isolationLevel: "RepeatableRead" }
    )
  }
  async function detailData(
    tx: Prisma.TransactionClient,
    owner: string,
    details: ApplicationDetails,
    previous?: { resumeVersionId: string | null }
  ) {
    let resume:
      | {
          resumeId: string
          resumeVersionId: string
          resumeSnapshot: Prisma.InputJsonValue
        }
      | undefined
    if (
      details.resumeVersionId &&
      details.resumeVersionId !== previous?.resumeVersionId
    ) {
      const found = (await confirmedResumes(tx, owner)).find(
        (r) => r.confirmedVersionId === details.resumeVersionId
      )
      if (!found) throw new UploadError("resume_not_confirmed", 409)
      resume = {
        resumeId: found.id,
        resumeVersionId: found.confirmedVersion!.id,
        resumeSnapshot: {
          title: found.title,
          version: found.confirmedVersion!.version,
          confirmedAt: found.confirmedAt!.toISOString(),
        },
      }
    }
    const { resumeVersionId, ...fields } = details
    return {
      ...fields,
      appliedOn: date(fields.appliedOn),
      followUpOn: date(fields.followUpOn),
      ...(resume ??
        (resumeVersionId === null
          ? {
              resumeId: null,
              resumeVersionId: null,
              resumeSnapshot: PrismaJsonNull,
            }
          : {})),
    }
  }
  async function mutate(user: CurrentAuthUser, value: unknown) {
    const parsed = applicationMutationSchema.safeParse(value)
    if (!parsed.success) throw new UploadError("invalid_input", 400)
    const action = parsed.data
    return db.$transaction(async (tx) => {
      // Same lock order as onboarding/discovery: serializes conversion and resume confirmation.
      await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id=${user.id} FOR NO KEY UPDATE`
      await requireCoreEntitlement(tx, user.id)
      const profile = await tx.userProfile.findUniqueOrThrow({
        where: { id: user.id },
      })
      if (!profile.onboardingCompletedAt)
        throw new UploadError("onboarding_required", 409)
      const today = calendarToday(profile.timezone ?? "UTC")
      if (
        (action.action === "create" || action.action === "edit") &&
        action.details.appliedOn &&
        action.details.appliedOn > today
      )
        throw new UploadError("future_application_date", 400)
      if (action.action === "track" || action.action === "create") {
        const existing = await tx.application.findFirst({
          where: {
            ownerUserId: user.id,
            ...(action.action === "track"
              ? { sourcePostingKey: action.postingId }
              : { creationKey: action.creationKey }),
          },
        })
        if (existing) return { applicationId: existing.id, created: false }
        let data: Prisma.ApplicationUncheckedCreateInput
        if (action.action === "track") {
          // Capture exactly the displayed private match, even if it has since become stale.
          const match = await tx.jobMatch.findFirst({
            where: {
              id: action.matchId,
              ownerUserId: user.id,
              jobPostingId: action.postingId,
            },
            include: {
              posting: { include: { board: { include: { company: true } } } },
            },
          })
          if (!match) throw new UploadError("job_not_found", 404)
          const p = match.posting
          data = {
            ownerUserId: user.id,
            jobPostingId: p.id,
            sourcePostingKey: p.id,
            creationKey: randomUUID(),
            company: p.board.company.name,
            title: p.title,
            location: p.location,
            postingUrl: p.originalUrl,
            sourceSnapshot: {
              kind: "discover",
              capturedAt: new Date().toISOString(),
              posting: {
                id: p.id,
                company: p.board.company.name,
                title: p.title,
                location: p.location,
                description: p.description,
                originalUrl: p.originalUrl,
                contentVersion: p.contentVersion,
                contentHash: p.contentHash,
                open: p.open,
                provider: p.board.provider,
              },
              match: {
                id: match.id,
                inputKey: match.inputKey,
                resumeId: match.resumeId,
                resumeVersionId: match.resumeVersionId,
                preferenceRevision: match.preferenceRevision,
                preferenceHash: match.preferenceHash,
                postingVersion: match.postingVersion,
                postingHash: match.postingHash,
                algorithmVersion: match.algorithmVersion,
                relevance: match.relevance,
                reasons: match.reasons,
                aiScore: match.aiScore,
                recommendation: match.recommendation,
                rationale: match.rationale,
                aiAnalyzedAt: match.aiAnalyzedAt?.toISOString() ?? null,
                stalePosting:
                  match.postingHash !== p.contentHash ||
                  match.postingVersion !== p.contentVersion,
              },
            },
          }
        } else {
          if (action.status === "applied" && !action.details.appliedOn)
            throw new UploadError("application_date_required", 400)
          data = {
            ownerUserId: user.id,
            creationKey: action.creationKey,
            sourceSnapshot: {
              kind: "manual",
              capturedAt: new Date().toISOString(),
              company: action.details.company,
              title: action.details.title,
              location: action.details.location,
              postingUrl: action.details.postingUrl,
            },
            ...(await detailData(tx, user.id, action.details)),
            status: action.status,
            stageName: action.stageName || null,
          }
        }
        const created = await tx.application.create({ data })
        await tx.applicationEvent.create({
          data: {
            ownerUserId: user.id,
            applicationId: created.id,
            revision: 0,
            kind: "created",
            toStatus: created.status,
            stageName: created.stageName,
            occurredOn: date(today)!,
          },
        })
        return { applicationId: created.id, created: true }
      }
      const current = await tx.application.findFirst({
        where: { id: action.applicationId, ownerUserId: user.id },
      })
      if (!current) throw new UploadError("application_not_found", 404)
      if (current.revision !== action.expectedRevision)
        throw new UploadError("application_conflict", 409)
      if (action.action === "delete") {
        if (!current.archivedAt)
          throw new UploadError("archive_before_delete", 409)
        await tx.application.delete({
          where: { ownerUserId_id: { ownerUserId: user.id, id: current.id } },
        })
        return { applicationId: current.id, deleted: true }
      }
      if (current.archivedAt && action.action !== "archive")
        throw new UploadError("application_archived", 409)
      const revision = current.revision + 1
      let update: Prisma.ApplicationUncheckedUpdateInput
      let event: Prisma.ApplicationEventUncheckedCreateInput | undefined
      if (action.action === "edit") {
        if (current.status === "applied" && !action.details.appliedOn)
          throw new UploadError("application_date_required", 400)
        update = await detailData(tx, user.id, action.details, current)
      } else if (action.action === "transition") {
        if (action.occurredOn > today)
          throw new UploadError("future_transition", 400)
        const stageName = action.stageName || null
        if (
          current.status === action.status &&
          current.stageName === stageName &&
          !action.note
        )
          return { applicationId: current.id, changed: false }
        update = {
          status: action.status,
          stageName,
          ...(action.status === "applied" && !current.appliedOn
            ? { appliedOn: date(action.occurredOn) }
            : {}),
        }
        event = {
          ownerUserId: user.id,
          applicationId: current.id,
          revision,
          kind: "transition",
          fromStatus: current.status,
          toStatus: action.status,
          stageName,
          occurredOn: date(action.occurredOn)!,
          note: action.note || null,
        }
      } else {
        if (!!current.archivedAt === action.archived)
          return { applicationId: current.id, changed: false }
        update = { archivedAt: action.archived ? new Date() : null }
        event = {
          ownerUserId: user.id,
          applicationId: current.id,
          revision,
          kind: action.archived ? "archived" : "restored",
          fromStatus: current.status,
          toStatus: current.status,
          stageName: current.stageName,
          occurredOn: date(today)!,
        }
      }
      const changed = await tx.application.updateMany({
        where: {
          ownerUserId: user.id,
          id: current.id,
          revision: action.expectedRevision,
        },
        data: { ...update, revision },
      })
      if (changed.count !== 1)
        throw new UploadError("application_conflict", 409)
      if (event) await tx.applicationEvent.create({ data: event })
      return { applicationId: current.id, changed: true }
    })
  }
  async function dashboard(user: CurrentAuthUser) {
    const data = await read(user)
    const active = data.applications.filter(
      (a) => !a.archivedAt && activeStatuses.includes(a.status)
    )
    const due = active
      .filter((a) => a.followUpOn && a.followUpOn <= data.today)
      .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!))
    const upcoming = active
      .filter((a) => a.followUpOn && a.followUpOn > data.today)
      .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!))
    const preparing = active.filter((a) => a.status === "saved")
    return {
      today: data.today,
      activeCount: active.length,
      appliedCount: active.filter((a) => a.status === "applied").length,
      interviewCount: active.filter((a) => a.status === "interview").length,
      offerCount: active.filter((a) => a.status === "offer").length,
      due: due.slice(0, 5),
      dueCount: due.length,
      upcoming: upcoming.slice(0, 3),
      preparing: preparing.slice(0, 3),
      attention: active.filter((a) => a.status !== "saved").slice(0, 3),
      recent: data.applications
        .flatMap((a) =>
          a.events.map((e) => ({ ...e, company: a.company, title: a.title }))
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    }
  }
  return { read, mutate, dashboard }
}
// Import the runtime null sentinel without exposing Prisma to browser bundles.
import { Prisma as PrismaRuntime } from "../../generated/prisma/client"
const PrismaJsonNull = PrismaRuntime.DbNull
