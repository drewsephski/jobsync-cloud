import "server-only"

import { db } from "@/lib/db"
import type { Prisma, UserProfile } from "@/lib/generated/prisma/client"
import type { CurrentAuthUser } from "@/lib/auth/session-context"

// Call only with the identity returned by the server's verified auth session.
export async function ensureUserProfile(
  user: CurrentAuthUser,
  database: Pick<Prisma.TransactionClient, "$queryRaw"> = db
): Promise<UserProfile> {
  try {
    // Prisma 7.10's empty-update upsert emits SELECT then INSERT. Explicit SQL
    // guarantees a single atomic Postgres upsert. The no-op update preserves
    // app edits and timestamps, and RETURNING works even after a racing insert.
    const [profile] = await database.$queryRaw<UserProfile[]>`
      INSERT INTO "UserProfile" ("id", "displayName", "createdAt", "updatedAt")
      VALUES (${user.id}, ${user.name}, now(), now())
      ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"
      RETURNING *
    `
    if (!profile) throw new Error("Missing profile")
    return profile
  } catch {
    throw new Error("Unable to load application profile")
  }
}
