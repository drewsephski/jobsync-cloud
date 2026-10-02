import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mock, test } from "node:test"
import {
  createSessionContext,
  type CurrentAuthUser,
} from "../lib/auth/session-context"

const user = await createSessionContext(
  async () => ({ data: { user: { id: "mcp-api-owner" } }, error: null }),
  () => {
    throw new Error("unexpected redirect")
  }
).requireCurrentAuthUser()
let session: CurrentAuthUser | null = user
let calls = 0
let received: unknown
mock.module(new URL("../lib/db.ts", import.meta.url).href, {
  namedExports: { db: {} },
})
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => session },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: { ensureUserProfile: async () => ({ id: user.id }) },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "https://jobsync.test" } },
})
mock.module(new URL("../lib/mcp/tokens.ts", import.meta.url).href, {
  namedExports: {
    createMcpTokenService: () => ({
      list: async (identity: CurrentAuthUser) => {
        assert.equal(identity.id, user.id)
        calls++
        return []
      },
      create: async (identity: CurrentAuthUser, input: unknown) => {
        assert.equal(identity.id, user.id)
        received = input
        calls++
        return { token: "shown-once", tokens: [] }
      },
      revoke: async (identity: CurrentAuthUser, input: unknown) => {
        assert.equal(identity.id, user.id)
        received = input
        calls++
        return { tokens: [] }
      },
    }),
  },
})
const { GET, POST, DELETE } = await import("../app/api/mcp/tokens/route")
const request = (body: string, origin = "https://jobsync.test") =>
  new Request("https://jobsync.test/api/mcp/tokens", {
    method: "POST",
    body,
    headers: { origin, "Content-Type": "application/json" },
  })
test("token management requires session ownership, same origin, bounded valid JSON, and never caches secrets", async () => {
  session = null
  assert.equal((await GET(request("{}"))).status, 401)
  session = user
  assert.equal((await POST(request("{}", "https://attacker.test"))).status, 403)
  assert.equal((await POST(request("x".repeat(4001)))).status, 400)
  assert.equal((await POST(request("invalid json"))).status, 400)
  assert.equal(calls, 0)
  const input = { name: "Codex", scopes: ["workspace:read"], expiresInDays: 30 }
  const response = await POST(request(JSON.stringify(input)))
  assert.equal(response.status, 201)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).token, "shown-once")
  assert.deepEqual(received, input)
  const tokenId = randomUUID()
  assert.equal((await DELETE(request(JSON.stringify({ tokenId })))).status, 200)
  assert.deepEqual(received, { tokenId })
  assert.deepEqual(await (await GET(request("{}"))).json(), { tokens: [] })
})
