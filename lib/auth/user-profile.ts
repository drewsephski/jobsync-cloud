import "server-only"

import { UploadError } from "../domain/resume-upload/service"
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
      SELECT ${user.id}, ${user.name}, CASE WHEN ${user.emailVerified === true} THEN now() END, CASE WHEN ${user.emailVerified === true} THEN now() END, CASE WHEN ${user.emailVerified === true} THEN now() + interval '14 days' END, now(), now()
      WHERE NOT EXISTS (SELECT 1 FROM "AccountDeletionRequest" WHERE "ownerUserId"=${user.id})
      ON CONFLICT ("id") DO UPDATE SET
        "emailVerifiedAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."emailVerifiedAt", now()) ELSE NULL END,
        "trialStartedAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."trialStartedAt", now()) ELSE "UserProfile"."trialStartedAt" END,
        "trialEndsAt" = CASE WHEN ${user.emailVerified === true} THEN COALESCE("UserProfile"."trialEndsAt", now() + interval '14 days') ELSE "UserProfile"."trialEndsAt" END
      WHERE "UserProfile"."deletionRequestedAt" IS NULL
      RETURNING *
    `
    if (!profile) throw new UploadError("account_deleting", 403)
    return profile
  } catch (error) {
    if (error instanceof UploadError) throw error
    throw new Error("Unable to load application profile")
  }
}
