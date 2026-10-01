import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"

nextEnv.loadEnvConfig(process.cwd())
const file = readFileSync(
  new URL("../.env.billingtest", import.meta.url),
  "utf8"
)
const match = file.match(
  /^BILLING_TEST_DATABASE_URL=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/m
)
const url =
  process.env.BILLING_TEST_DATABASE_URL ??
  match?.[1] ??
  match?.[2] ??
  match?.[3]
assert.ok(url, "Configure a schema-only test branch in .env.billingtest")
assert.ok(
  new URL(url).hostname.startsWith("ep-weathered-meadow-b46q35cx."),
  "Tests require the isolated schema-only branch"
)
const db = createDatabaseClient(url)
try {
  for (const id of ["resume", "discovery"]) {
    const policy = {
      enabled: true,
      ownerMonthlyUnits: BigInt(65),
      ownerMonthlyCostMicroUsd: BigInt(1_500_000),
      globalDailyCostMicroUsd: BigInt(5_000_000),
    }
    await db.aiBudgetPolicy.upsert({
      where: { id },
      create: { id, ...policy },
      update: policy,
    })
  }
} finally {
  await db.$disconnect()
}
for (const suite of [
  "db",
  "auth",
  "storage",
  "validation",
  "worker",
  "ai",
  "onboarding",
  "discovery",
  "applications",
  "billing",
  "account",
  "observability",
  "release",
]) {
  const result = spawnSync("pnpm", [`${suite}:test`], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      BILLING_TEST_DATABASE_URL: url,
      STRIPE_MODE: "test",
    },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
