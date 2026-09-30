import assert from "node:assert/strict"
import { test } from "node:test"
import { createTriggerHandler } from "../functions/trigger-handler"
const seen: string[] = []
let recovery = 0
const handler = createTriggerHandler(() => ({
  objectCreated: async (key) => {
    seen.push(key)
    return { status: "ignored" }
  },
  recover: async () => {
    recovery++
    return { processed: 0 }
  },
}))
export function triggerEnvelope(
  type = "storage_object_created",
  data: unknown = {
    bucket_name: "jobsync-files",
    object_key: "users/forged-owner/lookup-only.pdf",
  }
) {
  return {
    version: 1,
    invocation_id: "test-invocation",
    trigger: { type, id: "test-trigger", name: "test" },
    data,
  }
}
function request(
  body: unknown = triggerEnvelope(),
  path = "/object-created",
  header = "test-invocation"
) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: header ? { "X-Neon-Trigger-Invocation-Id": header } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}
test("missing trigger attestation returns 403", async () => {
  assert.equal((await handler(request(undefined, undefined, ""))).status, 403)
})
test("malformed JSON, wrong version/type/bucket/invocation and oversized bodies return 400", async () => {
  for (const body of [
    "broken",
    { ...triggerEnvelope(), version: 2 },
    triggerEnvelope("schedule"),
    triggerEnvelope("storage_object_created", {
      bucket_name: "wrong",
      object_key: "x",
    }),
    { ...triggerEnvelope(), invocation_id: "wrong" },
    "x".repeat(8193),
  ]) {
    assert.equal((await handler(request(body))).status, 400)
  }
})
test("object key is only passed as a lookup hint and unknown key is safe 2xx", async () => {
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ignored" })
  assert.equal(seen.at(-1), "users/forged-owner/lookup-only.pdf")
})
test("schedule validates its own envelope and returns counts", async () => {
  const response = await handler(
    request(
      triggerEnvelope("schedule", {
        scheduled_at: "2026-09-30T23:17:00Z",
      }),
      "/recover"
    )
  )
  assert.equal(response.status, 200)
  assert.equal(recovery, 1)
  assert.deepEqual(await response.json(), { processed: 0 })
})
test("infrastructure errors stay sanitized", async () => {
  const broken = createTriggerHandler(() => {
    throw new Error("secret bytes credentials request-url")
  })
  assert.deepEqual(await (await broken(request())).json(), {
    error: "dependency_unavailable",
  })
})
