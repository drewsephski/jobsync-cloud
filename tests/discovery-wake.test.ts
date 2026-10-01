import assert from "node:assert/strict"
import { test } from "node:test"
import { createDiscoveryWakeHandler } from "../functions/discovery-wake-handler"
import { wakeDiscovery } from "../lib/domain/discovery/wake"

const secret = "wake-secret-that-is-long-enough-for-production"
const ownerUserId = "auth_user-123"
const boardId = "f4f61dc2-1f40-4c01-b3a2-7077270c3582"
const payload = { ownerUserId, boardId }

function request(
  body: unknown = payload,
  options: { method?: string; authorization?: string; path?: string } = {}
) {
  return new Request(`https://worker.example${options.path ?? "/wake"}`, {
    method: options.method ?? "POST",
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    ...(options.method === "GET"
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  })
}

test("wake endpoint authenticates with a constant-time checked bearer secret and forwards scope", async () => {
  const calls: unknown[] = []
  const handler = createDiscoveryWakeHandler(
    () => ({ wake: async (input) => (calls.push(input), { accepted: true }) }),
    () => secret
  )

  const response = await handler(
    request(payload, { authorization: `Bearer ${secret}` })
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { accepted: true })
  assert.deepEqual(calls, [payload])
})

test("wake endpoint rejects missing or wrong credentials without invoking work", async () => {
  let calls = 0
  const handler = createDiscoveryWakeHandler(
    () => ({ wake: async () => (calls++, {}) }),
    () => secret
  )

  for (const authorization of [undefined, "Bearer wrong", `bearer ${secret}`]) {
    const response = await handler(request(payload, { authorization }))
    assert.equal(response.status, 401)
  }
  assert.equal(calls, 0)
})

test("wake endpoint enforces method, route, strict UUID/scoped payload, and 2KB bound", async () => {
  let calls = 0
  const handler = createDiscoveryWakeHandler(
    () => ({ wake: async () => (calls++, {}) }),
    () => secret
  )
  const authorization = `Bearer ${secret}`

  assert.equal(
    (await handler(request(undefined, { method: "GET", authorization })))
      .status,
    405
  )
  assert.equal(
    (await handler(request(payload, { path: "/other", authorization }))).status,
    404
  )
  for (const body of [
    "not-json",
    { ...payload, boardId: "not-a-uuid" },
    { ...payload, unrecognized: true },
    {},
    "x".repeat(2_049),
  ]) {
    assert.equal((await handler(request(body, { authorization }))).status, 400)
  }
  assert.equal(calls, 0)
})

test("wake endpoint returns a sanitized error when worker setup fails", async () => {
  const handler = createDiscoveryWakeHandler(
    () => {
      throw new Error("database password and connection string")
    },
    () => secret
  )

  const response = await handler(
    request(payload, { authorization: `Bearer ${secret}` })
  )
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "wake_unavailable" })
})

test("server wake posts only committed scope with auth and a bounded timeout", async () => {
  let captured: { url: URL; init: RequestInit } | undefined
  const result = await wakeDiscovery(payload, {
    env: {
      DISCOVERY_WORKER_URL: "https://branch-worker.neon.tech/base",
      DISCOVERY_WAKE_SECRET: secret,
    },
    fetcher: async (url, init) => {
      captured = { url: new URL(String(url)), init: init ?? {} }
      return Response.json({ accepted: true })
    },
    log: () => assert.fail("successful wake should not log failure"),
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(captured?.url.toString(), "https://branch-worker.neon.tech/wake")
  assert.equal(captured?.init.method, "POST")
  assert.equal(captured?.init.redirect, "error")
  assert.equal(
    new Headers(captured?.init.headers).get("authorization"),
    `Bearer ${secret}`
  )
  assert.deepEqual(JSON.parse(String(captured?.init.body)), payload)
  assert.ok(captured?.init.signal)
})

test("server wake failures are sanitized and return for scheduled recovery", async () => {
  const events: string[] = []
  let calls = 0
  const unavailable = await wakeDiscovery(
    { ownerUserId },
    {
      env: {
        DISCOVERY_WORKER_URL: "https://worker.example",
        DISCOVERY_WAKE_SECRET: secret,
      },
      fetcher: async () => {
        calls++
        throw new Error("secret URL and credentials")
      },
      log: (event) => events.push(event),
    }
  )
  const unconfigured = await wakeDiscovery(
    { ownerUserId },
    {
      env: {},
      fetcher: async () => {
        calls++
        return Response.json({})
      },
      log: (event) => events.push(event),
    }
  )

  assert.deepEqual(unavailable, { ok: false })
  assert.deepEqual(unconfigured, { ok: false })
  assert.equal(calls, 1)
  assert.equal(events.length, 2)
  assert.ok(
    events.every(
      (event) =>
        event ===
        JSON.stringify({ event: "discovery_wake", status: "unavailable" })
    )
  )
})

test("coordinated wake rotation accepts both keys only while the previous binding exists", async () => {
  const previous = "previous-production-secret-with-at-least-32-characters"
  let overlap: string | undefined = previous
  let calls = 0
  const handler = createDiscoveryWakeHandler(
    () => ({ wake: async () => (calls++, { accepted: true }) }),
    () => secret,
    () => overlap
  )
  assert.equal(
    (await handler(request(payload, { authorization: `Bearer ${previous}` })))
      .status,
    200
  )
  assert.equal(
    (await handler(request(payload, { authorization: `Bearer ${secret}` })))
      .status,
    200
  )
  overlap = undefined
  assert.equal(
    (await handler(request(payload, { authorization: `Bearer ${previous}` })))
      .status,
    401
  )
  assert.equal(calls, 2)
})
