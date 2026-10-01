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
      INSERT INTO "UserProfile" ("id", "displayName", "emailVerifiedAt", "trialStartedAt", "trialEndsAt", "createdAt", "updatedAt")
      VALUES (${user.id}, ${user.name}, CASE WHEN ${user.emailVerified === true} THEN now() END, CASE WHEN ${user.emailVerified === true} THEN now() END, CASE WHEN ${user.emailVerified === true} THEN now() + interval '14 days' END, now(), now())
      ON CONFLICT ("id") DO UPDATE SET
        "emailVerifiedAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."emailVerifiedAt", now()) ELSE NULL END,
        "trialStartedAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."trialStartedAt", now()) ELSE "UserProfile"."trialStartedAt" END,
        "trialEndsAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."trialEndsAt", now() + interval '14 days') ELSE "UserProfile"."trialEndsAt" END
      RETURNING *
    `
    if (!profile) throw new Error("Missing profile")
    return profile
  } catch {
    throw new Error("Unable to load application profile")
  }
}
