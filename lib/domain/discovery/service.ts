import { requireActiveAccount } from "../account/guard"
import { readEntitlement, requireEntitlement } from "../../billing/entitlements"
import { z } from "zod"
import type { PrismaClient } from "../../generated/prisma/client"
import type { CurrentAuthUser } from "../../auth/session-context"
import { UploadError } from "../resume-upload/service"
import { targetSchema } from "../onboarding/schema"
import { ALGORITHM_VERSION } from "./relevance"
import { profileInputs } from "./inputs"
import { createDiscoveryPlanner, MATCH_KIND } from "./planner"
import { freshBoardFilter } from "./catalog"
const watchSchema = z.strictObject({
  action: z.literal("watch"),
  boardId: z.uuid(),
  watching: z.boolean(),
})
const stateSchema = z.strictObject({
  action: z.literal("state"),
  postingId: z.uuid(),
  state: z.enum(["new", "saved", "dismissed"]),
})
const preferencesSchema = z
  .strictObject({
    action: z.literal("preferences"),
    expectedRevision: z.number().int().nonnegative(),
    targets: z.array(targetSchema).min(1).max(10),
  })
  .refine(
    (v) =>
      new Set(v.targets.map((t) => t.targetTitle.toLowerCase())).size ===
      v.targets.length
  )
const mutationSchema = z.union([
  watchSchema,
  stateSchema,
  preferencesSchema,
  z.strictObject({ action: z.literal("find") }),
])
export type DiscoveryData = Awaited<
  ReturnType<ReturnType<typeof createDiscoveryService>["read"]>
>
export function createDiscoveryService(db: PrismaClient) {
  const plan = createDiscoveryPlanner(db)
  async function read(user: CurrentAuthUser, search = "", filter = "new") {
    const query = search.trim().slice(0, 120)
    return db.$transaction(
      async (tx) => {
        const input = await profileInputs(tx, user.id)
        const entitlement = await readEntitlement(tx, user.id)
        const watches = await tx.companyWatch.findMany({
          where: { ownerUserId: user.id },
          include: { board: { include: { company: true } } },
          orderBy: { createdAt: "asc" },
        })
        const catalog = await tx.atsBoard.findMany({
          where: {
            enabled: true,
            ...(query
              ? {
                  company: {
                    name: { contains: query, mode: "insensitive" as const },
                  },
                }
              : {}),
          },
          include: {
            company: true,
            watches: {
              where: { ownerUserId: user.id },
              select: { boardId: true },
            },
          },
          orderBy: [{ company: { name: "asc" } }, { provider: "asc" }],
          take: 40,
        })
        const matches = input
          ? await tx.jobMatch.findMany({
              where: {
                ownerUserId: user.id,
                resumeVersionId: input.version.id,
                preferenceRevision: input.profile.preferenceRevision,
                preferenceHash: input.preferenceHash,
                algorithmVersion: ALGORITHM_VERSION,
                posting: { board: freshBoardFilter() },
              },
              include: {
                posting: { include: { board: { include: { company: true } } } },
              },
              orderBy: [{ relevance: "desc" }, { createdAt: "desc" }],
              take: 500,
            })
          : []
        const states = await tx.userJobState.findMany({
          where: { ownerUserId: user.id },
        })
        // Action history is independent of watches and bounded by results, not
        // by how many historical match revisions happen to exist.
        const historicalIds = await tx.$queryRaw<
          { id: string }[]
        >`SELECT m.id FROM "UserJobState" s
          JOIN LATERAL (SELECT id FROM "JobMatch" m WHERE m."ownerUserId"=s."ownerUserId" AND m."jobPostingId"=s."jobPostingId"
            ORDER BY m."createdAt" DESC,m.id LIMIT 1) m ON true
          WHERE s."ownerUserId"=${user.id} AND s.state <> 'new'
          ORDER BY s."updatedAt" DESC LIMIT 100`
        const historical = await tx.jobMatch.findMany({
          where: {
            id: { in: historicalIds.map((m) => m.id) },
            ownerUserId: user.id,
          },
          include: {
            posting: { include: { board: { include: { company: true } } } },
          },
        })
        matches.push(...historical)
        const applications = await tx.application.findMany({
          where: {
            ownerUserId: user.id,
            sourcePostingKey: { in: matches.map((m) => m.jobPostingId) },
          },
          select: { id: true, sourcePostingKey: true, archivedAt: true },
        })
        const applicationMap = new Map(
          applications.map((a) => [a.sourcePostingKey, a])
        )
        const stateMap = new Map(states.map((s) => [s.jobPostingId, s.state]))
        const isCurrent = (match: (typeof matches)[number]) =>
          !!input &&
          match.resumeVersionId === input.version.id &&
          match.preferenceRevision === input.profile.preferenceRevision &&
          match.preferenceHash === input.preferenceHash &&
          match.algorithmVersion === ALGORITHM_VERSION &&
          match.postingVersion === match.posting.contentVersion &&
          match.postingHash === match.posting.contentHash &&
          match.posting.board.enabled &&
          !!match.posting.board.lastSuccessAt &&
          match.posting.board.lastSuccessAt >=
            freshBoardFilter().lastSuccessAt.gte
        const unique = new Map<string, (typeof matches)[number]>()
        // Keep saved/dismissed history even after inputs change; stale AI scores are
        // never presented as current. New results require the exact active inputs.
        for (const match of matches.sort(
          (a, b) =>
            Number(isCurrent(b)) - Number(isCurrent(a)) ||
            b.createdAt.getTime() - a.createdAt.getTime()
        )) {
          const state = stateMap.get(match.jobPostingId) ?? "new"
          if (
            (isCurrent(match) || state !== "new") &&
            !unique.has(match.jobPostingId)
          )
            unique.set(match.jobPostingId, match)
        }
        const current = [...unique.values()].sort(
          (a, b) =>
            b.relevance - a.relevance ||
            a.jobPostingId.localeCompare(b.jobPostingId)
        )
        const counts = { new: 0, saved: 0, dismissed: 0 }
        for (const match of current)
          if (
            match.posting.open ||
            (stateMap.get(match.jobPostingId) ?? "new") !== "new"
          )
            counts[stateMap.get(match.jobPostingId) ?? "new"]++
        const chosen = ["new", "saved", "dismissed"].includes(filter)
          ? filter
          : "new"
        const boardView = (b: (typeof catalog)[number]) => ({
          id: b.id,
          company: b.company.name,
          provider: b.provider,
          watched: b.watches.length > 0,
          lastSuccessAt: b.lastSuccessAt?.toISOString() ?? null,
          errorCode: b.errorCode,
        })
        return {
          enhancing:
            (await tx.processingRun.count({
              where: {
                ownerUserId: user.id,
                kind: MATCH_KIND,
                status: { in: ["pending", "running", "retry_wait"] },
                availableAt: { lte: new Date() },
              },
            })) > 0,
          monitoring: watches.some(
            (w) =>
              w.board.enabled &&
              !w.board.errorCode &&
              (!w.board.lastSuccessAt || w.board.nextFetchAt <= new Date())
          ),
          watchLimit: entitlement.limits?.watches ?? 0,
          ready: !!input,
          preferenceRevision: input?.profile.preferenceRevision ?? 0,
          targets:
            input?.targets.map((t) => ({
              targetTitle: t.targetTitle,
              location: t.location,
              remotePreferred: t.remotePreferred,
              minimumCompensationUsd:
                t.minimumCompensationUsd === null
                  ? null
                  : Number(t.minimumCompensationUsd),
              keywords: t.keywords,
            })) ?? [],
          companies: catalog.map(boardView),
          watches: watches.map((w) =>
            boardView({ ...w.board, watches: [{ boardId: w.boardId }] })
          ),
          counts,
          jobs: current
            .filter(
              (m) =>
                (stateMap.get(m.jobPostingId) ?? "new") === chosen &&
                (chosen !== "new" || m.posting.open)
            )
            .slice(0, 50)
            .map((m) => ({
              id: m.jobPostingId,
              matchId: m.id,
              applicationId: applicationMap.get(m.jobPostingId)?.id ?? null,
              applicationArchived: !!applicationMap.get(m.jobPostingId)
                ?.archivedAt,
              title: m.posting.title,
              company: m.posting.board.company.name,
              boardId: m.posting.boardId,
              watched: watches.some((w) => w.boardId === m.posting.boardId),
              provider: m.posting.board.provider,
              location: m.posting.location,
              remote: m.posting.remote,
              originalUrl: m.posting.originalUrl,
              publishedAt: m.posting.publishedAt?.toISOString() ?? null,
              firstSeenAt: m.posting.firstSeenAt.toISOString(),
              open: m.posting.open,
              relevance: m.relevance,
              reasons: m.reasons,
              stale: !isCurrent(m),
              aiScore: isCurrent(m) && m.aiAnalyzedAt ? m.aiScore : null,
              recommendation: isCurrent(m) ? m.recommendation : null,
              rationale: isCurrent(m) ? m.rationale : null,
              aiAnalyzedAt: m.aiAnalyzedAt?.toISOString() ?? null,
              state: stateMap.get(m.jobPostingId) ?? "new",
            })),
        }
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 }
    )
  }
  async function mutate(user: CurrentAuthUser, value: unknown) {
    const parsed = mutationSchema.safeParse(value)
    if (!parsed.success) throw new UploadError("invalid_input", 400)
    const action = parsed.data
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${user.id} FOR NO KEY UPDATE`
        await requireActiveAccount(tx, user.id)
        const entitlement = await requireEntitlement(tx, user.id)
        const profile = await tx.userProfile.findUniqueOrThrow({
          where: { id: user.id },
        })
        if (!profile.onboardingCompletedAt)
          throw new UploadError("onboarding_required", 409)
        if (action.action === "find") {
          if (!(await profileInputs(tx, user.id)))
            throw new UploadError("resume_not_confirmed", 409)
        } else if (action.action === "watch") {
          const board = await tx.atsBoard.findFirst({
            where: { id: action.boardId, enabled: true },
          })
          if (!board) throw new UploadError("company_not_found", 404)
          if (action.watching) {
            const existing = await tx.companyWatch.findUnique({
              where: {
                ownerUserId_boardId: {
                  ownerUserId: user.id,
                  boardId: board.id,
                },
              },
            })
            if (
              !existing &&
              (await tx.companyWatch.count({
                where: { ownerUserId: user.id },
              })) >= entitlement.limits!.watches
            )
              throw new UploadError("watch_limit", 409)
            await tx.companyWatch.upsert({
              where: {
                ownerUserId_boardId: {
                  ownerUserId: user.id,
                  boardId: board.id,
                },
              },
              create: { ownerUserId: user.id, boardId: board.id },
              update: {},
            })
          } else
            await tx.companyWatch.deleteMany({
              where: { ownerUserId: user.id, boardId: board.id },
            })
        } else if (action.action === "state") {
          if (
            !(await tx.jobMatch.findFirst({
              where: { ownerUserId: user.id, jobPostingId: action.postingId },
            }))
          )
            throw new UploadError("job_not_found", 404)
          await tx.userJobState.upsert({
            where: {
              ownerUserId_jobPostingId: {
                ownerUserId: user.id,
                jobPostingId: action.postingId,
              },
            },
            create: {
              ownerUserId: user.id,
              jobPostingId: action.postingId,
              state: action.state,
            },
            update: { state: action.state },
          })
        } else {
          if (profile.preferenceRevision !== action.expectedRevision)
            throw new UploadError("preferences_conflict", 409)
          if (!(await profileInputs(tx, user.id)))
            throw new UploadError("resume_not_confirmed", 409)
          await tx.targetPreference.deleteMany({
            where: { ownerUserId: user.id, active: true },
          })
          await tx.targetPreference.createMany({
            data: action.targets.map((t) => ({
              ...t,
              ownerUserId: user.id,
              minimumCompensationUsd:
                t.minimumCompensationUsd === null
                  ? null
                  : BigInt(t.minimumCompensationUsd),
            })),
          })
          await tx.userProfile.update({
            where: { id: user.id },
            data: { preferenceRevision: { increment: 1 } },
          })
        }
        // Mutations serialize on the profile row. Allow bounded lock contention
        // without dropping valid concurrent watch changes at Prisma's 5s default.
      },
      { timeout: 30_000 }
    )
    if (action.action === "find" || action.action === "preferences") {
      const funnel = await plan(user.id)
      return {
        ok: true,
        data: await read(user),
        funnel,
        wake: { ownerUserId: user.id },
      }
    }
    return {
      ok: true,
      ...(action.action === "watch" && action.watching
        ? { wake: { ownerUserId: user.id, boardId: action.boardId } }
        : {}),
    }
  }
  return { read, mutate }
}
