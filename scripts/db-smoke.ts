import nextEnv from "@next/env"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")

// Load after environment initialization; react-server enables the server-only guard.
const { db } = await import("../lib/db")
try {
  const { checkDatabaseHealth } = await import("../lib/db-health")
  await checkDatabaseHealth()
  console.log(
    "Database smoke check passed: all foundation tables are readable."
  )
} catch {
  // Never print connection strings or driver errors that may contain credentials.
  console.error("Database smoke check failed.")
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
