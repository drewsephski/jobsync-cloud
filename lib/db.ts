import "server-only"

import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaClient } from "@/lib/generated/prisma/client"

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database access")
  }

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
