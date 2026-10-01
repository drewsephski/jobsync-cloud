import assert from "node:assert/strict"
import { mock, test } from "node:test"
import {
  createSessionContext,
  type CurrentAuthUser,
} from "../lib/auth/session-context"
import { UploadError } from "../lib/domain/resume-upload/service"

const user = await createSessionContext(
  async () => ({ data: { user: { id: "discovery-api-owner" } }, error: null }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
let session: CurrentAuthUser | null = user
let provisioned = 0
type Call =
  | { operation: "read"; user: CurrentAuthUser; search: string; state: string }
  | { operation: "mutate"; user: CurrentAuthUser; input: unknown }
const calls: Call[] = []

mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => session },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async (identity: CurrentAuthUser) => {
      assert.equal(identity.id, user.id)
      provisioned += 1
      return { id: identity.id }
    },
  },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "http://localhost:3000" } },
})
mock.module(new URL("../lib/db.ts", import.meta.url).href, {
  namedExports: { db: {} },
})
mock.module(
  new URL("../lib/domain/discovery/service.ts", import.meta.url).href,
  {
    namedExports: {
      createDiscoveryService: () => ({
        read: async (
          identity: CurrentAuthUser,
          search: string,
          state: string
        ) => {
          calls.push({ operation: "read", user: identity, search, state })
          return { ready: true, jobs: [] }
        },
        mutate: async (identity: CurrentAuthUser, input: unknown) => {
          calls.push({ operation: "mutate", user: identity, input })
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new UploadError("invalid_input", 400)
          const action = input as Record<string, unknown>
          const keysByAction: Record<string, string[]> = {
            watch: ["action", "boardId", "watching"],
            state: ["action", "postingId", "state"],
            preferences: ["action", "expectedRevision", "targets"],
          }
          const allowed = keysByAction[String(action.action)]
          if (
            !allowed ||
            Object.keys(action).some((key) => !allowed.includes(key))
          )
            throw new UploadError("invalid_input", 400)
          return { ok: true }
        },
      }),
    },
  }
)

const { GET, POST } = await import("../app/api/discovery/route")
const getRequest = (query = "") =>
  new Request(`http://localhost:3000/api/discovery${query}`)
const postRequest = (body: string, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/discovery", {
    method: "POST",
    body,
    headers: { origin, "content-type": "application/json" },
  })

const mutations = [
  {
    action: "watch",
    boardId: "00000000-0000-4000-8000-000000000001",
    watching: true,
  },
  {
    action: "state",
    postingId: "00000000-0000-4000-8000-000000000002",
    state: "saved",
  },
  {
    action: "preferences",
    expectedRevision: 0,
    targets: [
      {
        targetTitle: "Software Engineer",
        location: "Chicago, IL",
        remotePreferred: true,
        minimumCompensationUsd: null,
        keywords: ["TypeScript"],
      },
    ],
  },
]

test("anonymous discovery reads and mutations return no-store 401 without provisioning", async () => {
  session = null
  const beforeProvisioned = provisioned
  const beforeCalls = calls.length
  const responses = [
    await GET(getRequest()),
    await POST(postRequest(JSON.stringify(mutations[0]))),
  ]
  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { error: "unauthenticated" })
  }
  assert.equal(provisioned, beforeProvisioned)
  assert.equal(calls.length, beforeCalls)
  session = user
})

test("foreign origins and malformed or oversized JSON fail before domain mutation", async () => {
  const beforeProvisioned = provisioned
  const beforeCalls = calls.length
  const foreign = await POST(
    postRequest(JSON.stringify(mutations[0]), "https://cross-origin.example")
  )
  assert.equal(foreign.status, 403)
  assert.equal(foreign.headers.get("cache-control"), "no-store")
  assert.deepEqual(await foreign.json(), { error: "invalid_origin" })

  const invalidJson = await POST(postRequest("not-json"))
  assert.equal(invalidJson.status, 400)
  assert.deepEqual(await invalidJson.json(), { error: "invalid_input" })

  const tooLarge = await POST(postRequest(" ".repeat(20_001)))
  assert.equal(tooLarge.status, 400)
  assert.deepEqual(await tooLarge.json(), { error: "invalid_input" })
  assert.equal(provisioned, beforeProvisioned + 2)
  assert.equal(calls.length, beforeCalls)
})

test("verified session identity reaches reads and each supported mutation", async () => {
  const beforeCalls = calls.length
  const read = await GET(getRequest("?q=design%20systems&state=saved"))
  assert.equal(read.status, 200)
  assert.equal(read.headers.get("cache-control"), "no-store")
  assert.deepEqual(await read.json(), { ready: true, jobs: [] })

  for (const mutation of mutations) {
    const response = await POST(postRequest(JSON.stringify(mutation)))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { ok: true })
  }

  const invoked = calls.slice(beforeCalls)
  assert.deepEqual(
    invoked.map((call) => call.operation),
    ["read", "mutate", "mutate", "mutate"]
  )
  assert.ok(invoked.every((call) => call.user === user))
  assert.deepEqual(invoked[0], {
    operation: "read",
    user,
    search: "design systems",
    state: "saved",
  })
  assert.deepEqual(
    invoked.slice(1).map((call) => call.operation === "mutate" && call.input),
    mutations
  )
})

test("forged owner fields are passed only as untrusted input and rejected by the strict service contract", async () => {
  const beforeCalls = calls.length
  const response = await POST(
    postRequest(
      JSON.stringify({ ...mutations[0], ownerUserId: "another-user" })
    )
  )
  assert.equal(response.status, 400)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), { error: "invalid_input" })
  const call = calls.slice(beforeCalls).at(-1)
  assert.equal(call?.operation, "mutate")
  if (call?.operation === "mutate") {
    assert.equal(call.user, user)
    assert.deepEqual(call.input, {
      ...mutations[0],
      ownerUserId: "another-user",
    })
  }
})
