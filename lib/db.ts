import "server-only"

import type { PrismaClient } from "@/lib/generated/prisma/client"
import { createDatabaseClient } from "@/lib/backend/create-db-client"
import { serverEnv } from "@/lib/server-env"

const globalForDatabase = globalThis as unknown as {
  databaseClient?: PrismaClient
}

export const db =
  globalForDatabase.databaseClient ??
  createDatabaseClient(serverEnv.DATABASE_URL)

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.databaseClient = db
}
