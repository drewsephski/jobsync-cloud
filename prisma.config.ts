import nextEnv from "@next/env"
import { defineConfig } from "prisma/config"

// Match Next.js environment loading, including the ignored local env files.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")

// Prefer an explicit direct URL. Neon endpoints also expose a direct hostname
// by removing the pooler suffix, so a second local secret is not mandatory.
function schemaConnectionUrl(): string {
  if (process.env.DATABASE_URL_UNPOOLED) {
    return process.env.DATABASE_URL_UNPOOLED
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return "" // Offline validation/generation needs no URL.

  const url = new URL(connectionString)
  if (url.hostname.endsWith(".neon.tech")) {
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "")
  }
  return url.toString()
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Optional direct connection for CLI operations; runtime always uses DATABASE_URL.
    url: schemaConnectionUrl(),
  },
})
