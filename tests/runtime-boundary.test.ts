import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
test("trusted Function imports without Next/React conditions or web environment", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'await import("./functions/resume-worker.ts"); await import("./lib/backend/create-db-client.ts"); await import("./lib/backend/create-storage-client.ts")',
    ],
    { env: { NODE_ENV: "test" }, encoding: "utf8" }
  )
  assert.equal(
    result.status,
    0,
    "backend import must succeed without server-only or web env"
  )
})
