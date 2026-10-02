import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import nextEnv from "@next/env"

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
assert.ok(
  url,
  "Configure the isolated schema-only test branch in .env.billingtest"
)
assert.ok(
  new URL(url).hostname.startsWith("ep-weathered-meadow-b46q35cx."),
  "MCP tests require the isolated schema-only branch"
)
const result = spawnSync(
  process.execPath,
  [
    "--experimental-test-module-mocks",
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "tests/mcp.test.ts",
    "tests/mcp-api.test.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      STRIPE_MODE: "test",
    },
  }
)
process.exit(result.status ?? 1)
