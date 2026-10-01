import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { createSessionContext } from "../lib/auth/session-context"
const session = await createSessionContext(
  async () => ({
    data: { user: { id: "isolated-feedback-owner" } },
    error: null,
  }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
let authenticated = true
const calls: unknown[] = []
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: {
    getCurrentAuthUser: async () => (authenticated ? session : null),
  },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: { ensureUserProfile: async () => ({ id: session.id }) },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "https://jobsync.example.test" } },
})
mock.module(new URL("../lib/db.ts", import.meta.url).href, {
  namedExports: { db: {} },
})
mock.module(
  new URL("../lib/domain/feedback/service.ts", import.meta.url).href,
  {
    namedExports: {
      createFeedbackService: () => ({
        submit: async (owner: string, input: unknown) => {
          calls.push({ owner, input })
          return { received: true }
        },
      }),
    },
  }
)
const { POST } = await import("../app/api/feedback/route")
const request = (body: string, origin?: string) =>
  new Request("https://jobsync.example.test/api/feedback", {
    method: "POST",
    body,
    headers: origin ? { origin } : {},
  })
test("feedback API requires authentication and exact origin before accepting bounded chosen content", async () => {
  authenticated = false
  assert.equal(
    (await POST(request("{}", "https://jobsync.example.test"))).status,
    401
  )
  authenticated = true
  for (const origin of [undefined, "https://evil.example"])
    assert.equal((await POST(request("{}", origin))).status, 403)
  assert.equal(
    (await POST(request("x".repeat(10_001), "https://jobsync.example.test")))
      .status,
    400
  )
  assert.equal(
    (await POST(request("not-json", "https://jobsync.example.test"))).status,
    400
  )
  assert.equal(calls.length, 0)
  const response = await POST(
    request(
      '{"message":"chosen synthetic content"}',
      "https://jobsync.example.test"
    )
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(calls, [
    { owner: session.id, input: { message: "chosen synthetic content" } },
  ])
})
