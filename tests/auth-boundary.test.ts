import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test, mock } from "node:test"
import { createSessionContext } from "../lib/auth/session-context"
import type { ensureUserProfile } from "../lib/auth/user-profile"

const signInRedirect = new Error("sign-in redirect")
const contextFor = (data: unknown, error: unknown = null) =>
  createSessionContext(
    async () => ({ data, error }),
    () => {
      throw signInRedirect
    }
  )

test("missing session is nullable for APIs and redirects protected pages", async () => {
  const context = contextFor(null)
  assert.equal(await context.getCurrentAuthUser(), null)
  await assert.rejects(
    context.requireCurrentAuthUser(),
    (error) => error === signInRedirect
  )
})

test("identity comes only from the verified session and excludes tokens", async () => {
  const context = contextFor({
    user: {
      id: "verified-owner",
      name: "Actual name",
      email: "actual@example.com",
    },
    session: { token: "must-not-leave-server" },
    ownerUserId: "forged-owner",
  })
  const user = await context.requireCurrentAuthUser()
  assert.deepEqual(user, {
    id: "verified-owner",
    name: "Actual name",
    email: "actual@example.com",
  })
  const another = await contextFor({
    user: { id: "another-owner" },
  }).requireCurrentAuthUser()
  assert.equal(another.id, "another-owner")
  assert.equal(user.id, "verified-owner")
})

test("auth outages, malformed sessions, and upstream errors are not logout", async () => {
  for (const error of [
    { status: 502, message: "secret provider response" },
    { status: 401 },
  ]) {
    await assert.rejects(
      contextFor(null, error).getCurrentAuthUser(),
      /^Error: Authentication service unavailable$/
    )
  }
  await assert.rejects(
    contextFor({ user: { id: "" } }).getCurrentAuthUser(),
    /Invalid authenticated session/
  )
  const context = createSessionContext(
    async () => {
      throw new Error("token=secret")
    },
    () => {
      throw signInRedirect
    }
  )
  await assert.rejects(
    context.requireCurrentAuthUser(),
    /^Error: Authentication service unavailable$/
  )
})

// Compile-time guard: ordinary request/browser objects cannot provision a profile.
function identityTypeContract(provision: typeof ensureUserProfile) {
  // @ts-expect-error Browser IDs are not verified-session identities.
  void provision({ id: "browser-owner", name: "Forged", email: null })
}
void identityTypeContract

test("server configuration fails by variable name without leaking inputs", () => {
  const base = {
    ...process.env,
    AWS_ACCESS_KEY_ID: "test-access",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    AWS_ENDPOINT_URL_S3: "https://storage.example.com",
    AWS_REGION: "us-east-2",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgresql://user:private-password@example.com/test",
    DATABASE_URL_UNPOOLED: "",
    NEON_AUTH_BASE_URL: "https://auth.example.com/auth",
    NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
  }
  for (const key of [
    "DATABASE_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ENDPOINT_URL_S3",
    "AWS_REGION",
    "APP_ORIGIN",
    "NEON_AUTH_BASE_URL",
    "NEON_AUTH_COOKIE_SECRET",
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'await import("./lib/server-env.ts")',
      ],
      {
        env: { ...base, [key]: "" },
        encoding: "utf8",
      }
    )
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      new RegExp(`Invalid server environment: .*${key}`)
    )
    assert.ok(!result.stderr.includes("private-password"))
    assert.ok(!result.stderr.includes(base.NEON_AUTH_COOKIE_SECRET))
  }
  const shortSecret = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'await import("./lib/server-env.ts")',
    ],
    {
      env: { ...base, NEON_AUTH_COOKIE_SECRET: "short-private-secret" },
      encoding: "utf8",
    }
  )
  assert.notEqual(shortSecret.status, 0)
  assert.match(shortSecret.stderr, /NEON_AUTH_COOKIE_SECRET/)
  assert.ok(!shortSecret.stderr.includes("short-private-secret"))
})

// Mock only provider/framework boundaries; exercise the actual server actions.
const state = { error: null as unknown, throws: false, calls: 0 }
const proxyState = { status: 200, data: null as unknown, throws: false }
const sessionState = { data: null as unknown, error: null as unknown }
const provisionedOwners: string[] = []
const email = async () => {
  state.calls++
  if (state.throws) throw new Error("raw provider token")
  return { data: null, error: state.error }
}
mock.module(new URL("../lib/auth/server.ts", import.meta.url).href, {
  namedExports: {
    auth: {
      getSession: async (options: {
        query: { disableCookieCache: string }
      }) => {
        assert.equal(options.query.disableCookieCache, "true")
        return sessionState
      },
      signIn: { email },
      signUp: { email },
      signOut: email,
      middleware: () => async (request: Request) => {
        assert.equal(
          new URL(request.url).searchParams.get("disableCookieCache"),
          "true"
        )
        return new Response(null, {
          status: 307,
          headers: {
            location: "http://localhost/auth/sign-in?disableCookieCache=true",
          },
        })
      },
      handler: () => ({
        GET: async () => {
          if (proxyState.throws) throw new Error("raw upstream response")
          return Response.json(proxyState.data, { status: proxyState.status })
        },
      }),
    },
  },
})
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`redirect:${path}`)
    },
  },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async (user: { id: string; name: string | null }) => {
      provisionedOwners.push(user.id)
      return { id: user.id, displayName: user.name }
    },
  },
})
const { requireCurrentProfile } = await import("../lib/auth/context")
const { signInWithEmail } = await import("../app/auth/sign-in/actions")
const { signUpWithEmail } = await import("../app/auth/sign-up/actions")
const { signOut } = await import("../app/auth/actions")

test("successful signin/signup target dashboard; signout targets signin", async () => {
  const form = new FormData()
  form.set("email", "test@example.com")
  form.set("password", "valid-password")
  form.set("name", "Test")
  await assert.rejects(signInWithEmail(null, form), /redirect:\/dashboard/)
  await assert.rejects(signUpWithEmail(null, form), /redirect:\/dashboard/)
  await assert.rejects(signOut(), /redirect:\/auth\/sign-in/)
})

test("invalid inputs do not call provider and provider failures stay sanitized", async () => {
  const before = state.calls
  assert.ok((await signInWithEmail(null, new FormData()))?.error)
  assert.ok((await signUpWithEmail(null, new FormData()))?.error)
  assert.equal(state.calls, before)
  const form = new FormData()
  form.set("email", "test@example.com")
  form.set("password", "valid-password")
  form.set("name", "Test")
  state.error = { message: "raw provider token" }
  assert.ok(
    !(await signInWithEmail(null, form))?.error.includes("raw provider")
  )
  assert.ok(
    !(await signUpWithEmail(null, form))?.error.includes("raw provider")
  )
  await assert.rejects(
    signOut(),
    /^Error: Unable to sign out. Please try again\.$/
  )
  state.error = null
  state.throws = true
  assert.equal(
    (await signInWithEmail(null, form))?.error,
    "Authentication service unavailable. Please try again."
  )
  state.throws = false
})

test("proxy preserves anonymous redirects and surfaces provider failures", async () => {
  const { NextRequest } = await import("next/server")
  const { default: proxy, config } = await import("../proxy")
  const request = new NextRequest("http://localhost/dashboard")
  const anonymous = await proxy(request)
  assert.equal(anonymous.status, 307)
  assert.equal(
    anonymous.headers.get("location"),
    "http://localhost/auth/sign-in"
  )
  proxyState.status = 502
  const failure = await proxy(request)
  assert.equal(failure.status, 503)
  assert.equal(failure.headers.get("cache-control"), "no-store")
  assert.ok(!(await failure.text()).includes("raw upstream"))
  proxyState.status = 200
  proxyState.data = { invalid: "session" }
  assert.equal((await proxy(request)).status, 503)
  proxyState.data = null
  proxyState.throws = true
  assert.equal((await proxy(request)).status, 503)
  proxyState.throws = false
  assert.deepEqual(config.matcher, [
    "/account/:path*",
    "/dashboard/:path*",
    "/onboarding/:path*",
  ])
})

test("protected profile helper provisions only the verified owner, never anonymous requests", async () => {
  await assert.rejects(requireCurrentProfile(), /redirect:\/auth\/sign-in/)
  assert.deepEqual(provisionedOwners, [])
  sessionState.data = {
    user: { id: "session-owner", name: "Session name" },
    ownerUserId: "browser-owner",
  }
  const current = await requireCurrentProfile()
  assert.equal(current.user.id, "session-owner")
  assert.equal(current.profile.id, "session-owner")
  assert.deepEqual(provisionedOwners, ["session-owner"])
  sessionState.data = { user: { id: "second-owner" } }
  assert.equal((await requireCurrentProfile()).profile.id, "second-owner")
  assert.deepEqual(provisionedOwners, ["session-owner", "second-owner"])
  sessionState.data = null
})
