import "server-only"

import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaClient } from "@/lib/generated/prisma/client"
import { serverEnv } from "@/lib/server-env"

function createDatabaseClient() {
  const connectionString = serverEnv.DATABASE_URL

  const adapter = new PrismaNeon({ connectionString })
  return new PrismaClient({ adapter })
}

const globalForDatabase = globalThis as unknown as {
  databaseClient?: PrismaClient
}

export const db = globalForDatabase.databaseClient ?? createDatabaseClient()

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.databaseClient = db
}
