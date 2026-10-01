import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mock, test } from "node:test"
import { createSessionContext } from "../lib/auth/session-context"
import { confirmSchema, editSchema, preferencesSchema } from "../lib/domain/onboarding/schema"
import { UploadError } from "../lib/storage/upload-service"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const user = await createSessionContext(
  async () => ({ data: { user: { id: "onboarding-api-owner" } }, error: null }),
  () => { throw new Error("Unexpected redirect") }
).requireCurrentAuthUser()
let session: typeof user | null = user
let provisioned = 0
const calls: Array<{ operation: string; identity: typeof user; input?: unknown }> = []
let providerCalls = 0

mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => session },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async (identity: typeof user) => {
      assert.equal(identity.id, user.id)
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
mock.module(new URL("../lib/ai/openrouter.ts", import.meta.url).href, {
  namedExports: {
    createResumeStructurer: () => {
      providerCalls++
      throw new Error("Provider must not be called by onboarding API")
    },
  },
})
mock.module(new URL("../lib/domain/onboarding/service.ts", import.meta.url).href, {
  namedExports: {
    createOnboardingService: () => ({
      read: async (identity: typeof user) => {
        calls.push({ operation: "read", identity })
        return { step: "review" }
      },
      save: async (identity: typeof user, input: unknown) => {
        const parsed = editSchema.safeParse(input)
        if (!parsed.success) throw new UploadError("invalid_input", 400)
        calls.push({ operation: "save", identity, input })
        if (parsed.data.expectedVersionId === "00000000-0000-4000-8000-000000000404")
          throw new UploadError("resume_not_found", 404)
        if (parsed.data.expectedVersionId === "00000000-0000-4000-8000-000000000409")
          throw new UploadError("version_conflict", 409)
        return { saved: true }
      },
      confirm: async (identity: typeof user, input: unknown) => {
        const parsed = confirmSchema.safeParse(input)
        if (!parsed.success) throw new UploadError("invalid_input", 400)
        calls.push({ operation: "confirm", identity, input })
        if (parsed.data.expectedVersionId === "00000000-0000-4000-8000-000000000404")
          throw new UploadError("resume_not_found", 404)
        if (parsed.data.expectedVersionId === "00000000-0000-4000-8000-000000000409")
          throw new UploadError("version_conflict", 409)
        return { confirmed: true }
      },
      preferences: async (identity: typeof user, input: unknown) => {
        const parsed = preferencesSchema.safeParse(input)
        if (!parsed.success) throw new UploadError("invalid_input", 400)
        calls.push({ operation: "preferences", identity, input })
        if (parsed.data.expectedVersionId === "00000000-0000-4000-8000-000000000404")
          throw new UploadError("resume_not_found", 404)
        if (parsed.data.expectedRevision === 9)
          throw new UploadError("preferences_conflict", 409)
        return { saved: true }
      },
    }),
  },
})

const { GET, POST } = await import("../app/api/onboarding/route")
const jsonRequest = (body: string, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/onboarding", {
    method: "POST",
    body,
    headers: { origin, "content-type": "application/json" },
  })
const validResume = {
  contact: { name: "Alex Example", email: "alex@example.test", phone: null, location: null, links: [] },
  summary: "A user-written summary.",
  skills: ["TypeScript"],
  employment: [], education: [], credentials: [],
}
const validTarget = {
  targetTitle: "Software Engineer", location: "Chicago, IL", remotePreferred: true,
  minimumCompensationUsd: null, keywords: ["TypeScript"],
}
const actions = [
  { action: "save", input: { expectedVersionId: "00000000-0000-4000-8000-000000000001", data: validResume } },
  { action: "confirm", input: { expectedVersionId: "00000000-0000-4000-8000-000000000001" } },
  { action: "preferences", input: { expectedVersionId: "00000000-0000-4000-8000-000000000001", expectedRevision: 0, targets: [validTarget], complete: true } },
]

test("anonymous onboarding requests return no-store 401 without profile or domain work", async () => {
  session = null
  const beforeProvisioned = provisioned
  const beforeCalls = calls.length
  const responses = [
    await GET(new Request("http://localhost:3000/api/onboarding")),
    await POST(jsonRequest(JSON.stringify(actions[1]))),
  ]
  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(provisioned, beforeProvisioned)
  assert.equal(calls.length, beforeCalls)
  session = user
})

test("origin checks, malformed requests, oversized bodies, and forged owners fail before service operations", async () => {
  const beforeCalls = calls.length
  const beforeProvisioned = provisioned
  assert.equal((await POST(jsonRequest(JSON.stringify(actions[1]), "https://attacker.example"))).status, 403)
  for (const body of ["not-json", JSON.stringify({ action: "unknown", input: {} }), JSON.stringify({ ...actions[1], ownerUserId: user.id }), JSON.stringify({ action: "confirm", input: { ...actions[1]!.input, ownerUserId: user.id } })]) {
    assert.equal((await POST(jsonRequest(body))).status, 400)
  }
  assert.equal((await POST(jsonRequest(" ".repeat(250_001)))).status, 400)
  assert.equal(calls.length, beforeCalls)
  assert.equal(provisioned, beforeProvisioned + 5)
})

test("all onboarding actions receive the verified session identity and responses are private", async () => {
  const beforeCalls = calls.length
  const read = await GET(new Request("http://localhost:3000/api/onboarding"))
  assert.equal(read.status, 200)
  assert.equal(read.headers.get("cache-control"), "no-store")
  assert.deepEqual(await read.json(), { step: "review" })
  for (const action of actions) {
    const response = await POST(jsonRequest(JSON.stringify(action)))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  const invoked = calls.slice(beforeCalls)
  assert.deepEqual(invoked.map((call) => call.operation), ["read", "save", "confirm", "preferences"])
  assert.ok(invoked.every((call) => call.identity === user))
})

test("resume and preference concurrency errors map to 404 and 409 without leaking details", async () => {
  const requests = [
    { action: "confirm", input: { expectedVersionId: "00000000-0000-4000-8000-000000000404" } },
    { action: "confirm", input: { expectedVersionId: "00000000-0000-4000-8000-000000000409" } },
    { action: "preferences", input: { expectedVersionId: "00000000-0000-4000-8000-000000000001", expectedRevision: 9, targets: [validTarget], complete: false } },
  ]
  const responses = await Promise.all(requests.map((item) => POST(jsonRequest(JSON.stringify(item)))))
  assert.deepEqual(responses.map((response) => response.status), [404, 409, 409])
  assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
    { error: "resume_not_found" }, { error: "version_conflict" }, { error: "preferences_conflict" },
  ])
  assert.ok(responses.every((response) => response.headers.get("cache-control") === "no-store"))
})

test("onboarding's transitive source graph excludes AI providers and processing workers", async () => {
  const visited = new Set<string>()
  const queue = [join(root, "app/api/onboarding/route.ts"), join(root, "lib/domain/onboarding/service.ts")]
  const forbidden = /(?:^|\/)(?:openrouter|resume-structure\/worker|resume-structure\/accounting|processing-run\/resume-worker)(?:\.ts)?$/
  const importPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  while (queue.length) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    assert.equal(forbidden.test(file.replaceAll("\\", "/")), false, `forbidden import: ${file}`)
    const source = await readFile(file, "utf8")
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]!
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue
      const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : resolve(dirname(file), specifier)
      const candidates = extname(base) ? [base] : [`${base}.ts`, join(base, "index.ts")]
      for (const candidate of candidates) {
        try { await readFile(candidate); queue.push(candidate); break } catch { /* Try next source extension. */ }
      }
    }
  }
  assert.ok([...visited].some((file) => file.endsWith("/lib/ai/resume-schema.ts")))
  assert.equal(providerCalls, 0)
})
