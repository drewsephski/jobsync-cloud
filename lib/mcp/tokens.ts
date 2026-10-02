import "server-only"
import { createHash, randomBytes } from "node:crypto"
import type { PrismaClient, Prisma } from "../generated/prisma/client"
import type { CurrentAuthUser } from "../auth/session-context"
import { requireActiveAccount } from "../domain/account/guard"
import { UploadError } from "../domain/resume-upload/service"
import {
  tokenCreateSchema,
  tokenRevokeSchema,
  type McpTokenView,
} from "./schema"

const publicSelect = {
  id: true,
  name: true,
  tokenPrefix: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.McpAccessTokenSelect
export const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex")
export function bearerToken(request: Request) {
  const match = /^Bearer (jsc_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") ?? ""
  )
  return match?.[1] ?? null
}
export function createMcpTokenService(db: PrismaClient) {
  async function list(user: CurrentAuthUser): Promise<McpTokenView[]> {
    return db.$transaction(async (tx) => {
      await requireActiveAccount(tx, user.id)
      const tokens = await tx.mcpAccessToken.findMany({
        where: { ownerUserId: user.id },
        select: publicSelect,
        orderBy: [
          { revokedAt: { sort: "asc", nulls: "first" } },
          { expiresAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 100,
      })
      return tokens.map((t) => ({
        ...t,
        expiresAt: t.expiresAt.toISOString(),
        revokedAt: t.revokedAt?.toISOString() ?? null,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))
    })
  }
  async function lock(tx: Prisma.TransactionClient, owner: string) {
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id=${owner} FOR NO KEY UPDATE`
    await requireActiveAccount(tx, owner)
  }
  return {
    list,
    async create(user: CurrentAuthUser, input: unknown) {
      const parsed = tokenCreateSchema.safeParse(input)
      if (!parsed.success) throw new UploadError("invalid_input", 400)
      const token = `jsc_${randomBytes(32).toString("base64url")}`
      await db.$transaction(async (tx) => {
        await lock(tx, user.id)
        const count = await tx.mcpAccessToken.count({
          where: {
            ownerUserId: user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        })
        if (count >= 20) throw new UploadError("token_limit", 409)
        await tx.mcpAccessToken.create({
          data: {
            ownerUserId: user.id,
            name: parsed.data.name,
            scopes: parsed.data.scopes,
            tokenHash: tokenDigest(token),
            tokenPrefix: token.slice(0, 12),
            expiresAt: new Date(
              Date.now() + parsed.data.expiresInDays * 86400_000
            ),
          },
        })
      })
      // Plaintext is returned once and never persisted or logged.
      return { token, tokens: await list(user) }
    },
    async revoke(user: CurrentAuthUser, input: unknown) {
      const parsed = tokenRevokeSchema.safeParse(input)
      if (!parsed.success) throw new UploadError("invalid_input", 400)
      await db.$transaction(async (tx) => {
        await lock(tx, user.id)
        const result = await tx.mcpAccessToken.updateMany({
          where: { id: parsed.data.tokenId, ownerUserId: user.id },
          data: { revokedAt: new Date() },
        })
        if (!result.count) throw new UploadError("token_not_found", 404)
      })
      return { tokens: await list(user) }
    },
  }
}

export async function resolveMcpToken(
  db: PrismaClient,
  token: string,
  consume = true
) {
  const found = await db.mcpAccessToken.findFirst({
    where: {
      tokenHash: tokenDigest(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      owner: { deletionRequestedAt: null },
    },
    include: { owner: true },
  })
  if (!found) throw new UploadError("invalid_token", 401)
  if (consume) {
    // Postgres owns the rate window across all serverless instances. Recheck
    // expiry/revocation and account state in the atomic update as well.
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE "McpAccessToken" t SET
        "rateCount"=CASE WHEN "rateWindowAt" <= now()-interval '1 minute' THEN 1 ELSE "rateCount"+1 END,
        "rateWindowAt"=CASE WHEN "rateWindowAt" <= now()-interval '1 minute' THEN now() ELSE "rateWindowAt" END,
        "lastUsedAt"=now()
      WHERE t.id=${found.id}::uuid AND "revokedAt" IS NULL AND "expiresAt">now()
        AND ("rateWindowAt"<=now()-interval '1 minute' OR "rateCount"<120)
        AND EXISTS (SELECT 1 FROM "UserProfile" p WHERE p.id=t."ownerUserId" AND p."deletionRequestedAt" IS NULL)
      RETURNING t.id`
    if (!rows.length)
      throw new UploadError("token_unavailable_or_rate_limited", 429)
  }
  // This is the other trusted identity boundary: ownership comes exclusively
  // from a verified opaque token, never from tool arguments or browser cookies.
  const user = {
    id: found.ownerUserId,
    name: found.owner.displayName,
    email: null,
    emailVerified: !!found.owner.emailVerifiedAt,
  } as CurrentAuthUser
  return { user, scopes: found.scopes }
}
