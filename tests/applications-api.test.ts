import assert from "node:assert/strict"
import { mock, test } from "node:test"
import {
  createSessionContext,
  type CurrentAuthUser,
} from "../lib/auth/session-context"
import { applicationMutationSchema } from "../lib/domain/applications/schema"
import { UploadError } from "../lib/domain/resume-upload/service"

const user = await createSessionContext(
  async () => ({
    data: { user: { id: "applications-api-owner" } },
    error: null,
  }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
let session: CurrentAuthUser | null = user
let provisioned = 0
const calls: Array<{
  operation: string
  user: CurrentAuthUser
  input?: unknown
}> = []
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => session },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async (identity: CurrentAuthUser) => {
      provisioned++
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
  new URL("../lib/domain/applications/service.ts", import.meta.url).href,
  {
    namedExports: {
      createApplicationService: () => ({
        read: async (identity: CurrentAuthUser) => {
          calls.push({ operation: "read", user: identity })
          return { applications: [], today: "2026-10-01", resumes: [] }
        },
        mutate: async (identity: CurrentAuthUser, input: unknown) => {
          calls.push({ operation: "mutate", user: identity, input })
          const parsed = applicationMutationSchema.safeParse(input)
          if (!parsed.success) throw new UploadError("invalid_input", 400)
          if (
            parsed.data.action === "track" &&
            parsed.data.matchId.endsWith("04")
          )
            throw new UploadError("job_not_found", 404)
          if (
            parsed.data.action === "edit" &&
            parsed.data.expectedRevision === 9
          )
            throw new UploadError("application_conflict", 409)
          if (
            parsed.data.action === "delete" &&
            parsed.data.expectedRevision === 8
          )
            throw new UploadError("archive_before_delete", 409)
          if (
            (parsed.data.action === "create" ||
              parsed.data.action === "edit") &&
            parsed.data.details.appliedOn &&
            parsed.data.details.appliedOn > "2026-10-01"
          )
            throw new UploadError("future_application_date", 400)
          return { ok: true }
        },
      }),
    },
  }
)

const { GET, POST } = await import("../app/api/applications/route")
const post = (body: string, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/applications", {
    method: "POST",
    body,
    headers: { origin, "content-type": "application/json" },
  })
const uuid = (last: string) => `00000000-0000-4000-8000-0000000000${last}`
const detail = {
  company: "Example Co",
  title: "Staff Engineer",
  location: "Remote",
  postingUrl: "https://jobs.example.test/role",
  salary: null,
  notes: null,
  appliedOn: null,
  followUpOn: null,
  nextAction: null,
  resumeVersionId: null,
}
const mutations = [
  { action: "track", postingId: uuid("01"), matchId: uuid("02") },
  {
    action: "create",
    creationKey: uuid("03"),
    details: { ...detail, appliedOn: "2026-09-30" },
    status: "applied",
    stageName: null,
  },
  {
    action: "edit",
    applicationId: uuid("04"),
    expectedRevision: 0,
    details: detail,
  },
  {
    action: "transition",
    applicationId: uuid("04"),
    expectedRevision: 0,
    status: "interview",
    stageName: "Panel",
    occurredOn: "2026-09-30",
    note: null,
  },
  {
    action: "archive",
    applicationId: uuid("04"),
    expectedRevision: 0,
    archived: true,
  },
  { action: "delete", applicationId: uuid("04"), expectedRevision: 1 },
]

test("anonymous application requests return private 401 without provisioning or domain calls", async () => {
  session = null
  const provisionBefore = provisioned,
    callsBefore = calls.length
  const responses = [
    await GET(new Request("http://localhost:3000/api/applications")),
    await POST(post(JSON.stringify(mutations[0]))),
  ]
  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { error: "unauthenticated" })
  }
  assert.equal(provisioned, provisionBefore)
  assert.equal(calls.length, callsBefore)
  session = user
})

test("origin, body bounds, malformed JSON, and forged owner fields fail before mutation", async () => {
  const beforeCalls = calls.length
  assert.equal(
    (await POST(post(JSON.stringify(mutations[0]), "https://attacker.example")))
      .status,
    403
  )
  for (const body of [
    "not-json",
    JSON.stringify({ ...mutations[0], ownerUserId: user.id }),
    JSON.stringify({
      ...mutations[0],
      details: { ...detail, ownerUserId: user.id },
    }),
  ]) {
    assert.equal((await POST(post(body))).status, 400)
  }
  assert.equal((await POST(post(" ".repeat(60_001)))).status, 400)
  // Strict contract validation happens in the domain service, after authenticated
  // dispatch; the extra fields reach it as untrusted input and are rejected there.
  assert.equal(calls.length, beforeCalls + 2)
})

test("verified identity reaches every strict mutation and responses are no-store", async () => {
  const beforeCalls = calls.length
  const read = await GET(new Request("http://localhost:3000/api/applications"))
  assert.equal(read.status, 200)
  assert.equal(read.headers.get("cache-control"), "no-store")
  assert.deepEqual(await read.json(), {
    applications: [],
    today: "2026-10-01",
    resumes: [],
  })
  for (const mutation of mutations) {
    const response = await POST(post(JSON.stringify(mutation)))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { ok: true })
  }
  const invoked = calls.slice(beforeCalls)
  assert.deepEqual(
    invoked.map((call) => call.operation),
    ["read", ...mutations.map(() => "mutate")]
  )
  assert.ok(invoked.every((call) => call.user === user))
  assert.deepEqual(
    invoked.slice(1).map((call) => call.input),
    mutations
  )
})

test("schema rejects extra fields, invalid dates and unsafe URLs; domain errors stay sanitized", async () => {
  for (const input of [
    { ...mutations[0], ownerUserId: user.id },
    { ...mutations[1], details: { ...detail, appliedOn: "2026-02-30" } },
    {
      ...mutations[1],
      details: { ...detail, postingUrl: "javascript:alert(1)" },
    },
    { ...mutations[1], details: { ...detail, notes: "x".repeat(10_001) } },
  ]) {
    const response = await POST(post(JSON.stringify(input)))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: "invalid_input" })
  }
  const errors = [
    {
      input: { action: "track", postingId: uuid("01"), matchId: uuid("04") },
      status: 404,
      error: "job_not_found",
    },
    {
      input: {
        action: "edit",
        applicationId: uuid("04"),
        expectedRevision: 9,
        details: detail,
      },
      status: 409,
      error: "application_conflict",
    },
    {
      input: {
        action: "delete",
        applicationId: uuid("04"),
        expectedRevision: 8,
      },
      status: 409,
      error: "archive_before_delete",
    },
    {
      input: {
        action: "create",
        creationKey: uuid("05"),
        details: { ...detail, appliedOn: "2026-10-02" },
        status: "applied",
        stageName: null,
      },
      status: 400,
      error: "future_application_date",
    },
    {
      input: {
        action: "edit",
        applicationId: uuid("04"),
        expectedRevision: 0,
        details: { ...detail, appliedOn: "2026-10-02" },
      },
      status: 400,
      error: "future_application_date",
    },
  ]
  for (const item of errors) {
    const response = await POST(post(JSON.stringify(item.input)))
    assert.equal(response.status, item.status)
    assert.deepEqual(await response.json(), { error: item.error })
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
})
