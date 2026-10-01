import assert from "node:assert/strict"
import { mock, test } from "node:test"
import {
  createSessionContext,
  type CurrentAuthUser,
} from "../lib/auth/session-context"

const user = await createSessionContext(
  async () => ({
    data: {
      user: {
        id: "account-api-fixture",
        name: "Fixture User",
        email: "fixture@example.test",
        emailVerified: true,
      },
    },
    error: null,
  }),
  () => {
    throw new Error("Unexpected redirect")
  }
).requireCurrentAuthUser()
let currentUser: CurrentAuthUser | null = user
let authResult: {
  error: unknown
  data: { user: { id: string } } | null
} = { error: null, data: { user: { id: user.id } } }
const profileExists = true
let provisions = 0
let authCalls: Array<{ email: string; password: string }> = []
let databaseCalls: Array<{ owner: string; profile?: Record<string, unknown> }> =
  []
let deletionCalls: Array<{ operation: string; owner: string }> = []
let exportCalls: string[] = []

const transactionClient = {
  $queryRaw: async () => (profileExists ? [{ id: user.id }] : []),
  userProfile: {
    update: async (input: {
      where: { id: string }
      data: Record<string, unknown>
    }) => {
      databaseCalls.push({ owner: input.where.id, profile: input.data })
    },
  },
}
const db = {
  $transaction: async (
    operation: (tx: typeof transactionClient) => Promise<unknown>
  ) => operation(transactionClient),
}
const auth = {
  signIn: {
    email: async (input: { email: string; password: string }) => {
      authCalls.push(input)
      return authResult
    },
  },
}
mock.module(new URL("../lib/db.ts", import.meta.url).href, {
  namedExports: { db },
})
mock.module(new URL("../lib/auth/server.ts", import.meta.url).href, {
  namedExports: { auth },
})
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => currentUser },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async () => {
      provisions++
    },
  },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "https://jobsync.example" } },
})
mock.module(new URL("../lib/domain/account/export.ts", import.meta.url).href, {
  namedExports: {
    exportAccount: async (_database: unknown, identity: CurrentAuthUser) => {
      exportCalls.push(identity.id)
      return {
        format: "jobsync-cloud-export-v1",
        usage: { reservedUnits: BigInt(3) },
      }
    },
  },
})
mock.module(
  new URL("../lib/domain/account/deletion.ts", import.meta.url).href,
  {
    namedExports: {
      createAccountDeletion: () => ({
        request: async (owner: string) => {
          deletionCalls.push({ operation: "request", owner })
          return { status: "pending", requestedAt: "2026-10-01T00:00:00.000Z" }
        },
        process: async (owner: string) => {
          deletionCalls.push({ operation: "process", owner })
          return "retry_wait"
        },
      }),
    },
  }
)
mock.module(
  new URL("../lib/domain/account/providers.ts", import.meta.url).href,
  {
    namedExports: { accountCleanup: () => ({}) },
  }
)

const { accountApi } = await import("../lib/domain/account/api")

function bodyRequest(body: string, origin = "https://jobsync.example") {
  return new Request("https://jobsync.example/api/account", {
    method: "POST",
    body,
    headers: { origin, "content-type": "application/json" },
  })
}

function resetCalls() {
  authCalls = []
  databaseCalls = []
  deletionCalls = []
  exportCalls = []
}

test("anonymous and cross-origin account requests stop before profile provisioning", async () => {
  currentUser = null
  const before = provisions
  const unauthenticated = await accountApi(bodyRequest("{}"), "profile")
  assert.equal(unauthenticated.status, 401)
  assert.deepEqual(await unauthenticated.json(), { error: "unauthenticated" })
  assert.equal(
    unauthenticated.headers.get("cache-control"),
    "no-store, private"
  )
  assert.equal(provisions, before)

  currentUser = user
  const crossOrigin = await accountApi(
    bodyRequest("{}", "https://attacker.example"),
    "profile"
  )
  assert.equal(crossOrigin.status, 403)
  assert.deepEqual(await crossOrigin.json(), { error: "invalid_origin" })
  assert.equal(provisions, before)
  assert.equal(databaseCalls.length, 0)
  assert.equal(deletionCalls.length, 0)
})

test("malformed, oversized and forged account payloads fail without account mutations", async () => {
  currentUser = user
  resetCalls()
  const malformed = await accountApi(bodyRequest("{"), "delete")
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: "invalid_input" })

  const oversized = await accountApi(bodyRequest(" ".repeat(4097)), "profile")
  assert.equal(oversized.status, 400)
  assert.deepEqual(await oversized.json(), { error: "invalid_input" })

  const forged = await accountApi(
    bodyRequest(
      JSON.stringify({
        displayName: "Changed",
        timezone: "UTC",
        ownerUserId: "another-user",
      })
    ),
    "profile"
  )
  assert.equal(forged.status, 400)
  assert.deepEqual(await forged.json(), { error: "invalid_input" })
  assert.equal(databaseCalls.length, 0)
  assert.equal(deletionCalls.length, 0)
  assert.equal(authCalls.length, 0)
})

test("profile changes validate timezone and persist only to the verified session owner", async () => {
  currentUser = user
  resetCalls()
  const invalid = await accountApi(
    bodyRequest(
      JSON.stringify({
        displayName: "Fixture User",
        timezone: "Mars/Olympus_Mons",
      })
    ),
    "profile"
  )
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { error: "invalid_input" })
  assert.equal(databaseCalls.length, 0)

  const valid = await accountApi(
    bodyRequest(
      JSON.stringify({
        displayName: "Updated Fixture",
        timezone: "America/Chicago",
      })
    ),
    "profile"
  )
  assert.equal(valid.status, 200)
  assert.deepEqual(await valid.json(), { saved: true })
  assert.equal(valid.headers.get("cache-control"), "no-store, private")
  assert.deepEqual(databaseCalls, [
    {
      owner: user.id,
      profile: { displayName: "Updated Fixture", timezone: "America/Chicago" },
    },
  ])
})

test("account deletion reauthenticates before queueing and uses the verified owner", async () => {
  currentUser = user
  resetCalls()
  authResult = { error: new Error("provider detail"), data: null }
  const wrongPassword = await accountApi(
    bodyRequest(
      JSON.stringify({
        confirmation: "DELETE MY ACCOUNT",
        password: "wrong-password",
      })
    ),
    "delete"
  )
  assert.equal(wrongPassword.status, 403)
  assert.deepEqual(await wrongPassword.json(), {
    error: "account_reauthentication_required",
  })
  assert.equal(authCalls.length, 1)
  assert.deepEqual(authCalls[0], {
    email: user.email,
    password: "wrong-password",
  })
  assert.equal(deletionCalls.length, 0)

  authResult = { error: null, data: { user: { id: "different-user" } } }
  const wrongIdentity = await accountApi(
    bodyRequest(
      JSON.stringify({
        confirmation: "DELETE MY ACCOUNT",
        password: "valid-password",
      })
    ),
    "delete"
  )
  assert.equal(wrongIdentity.status, 403)
  assert.equal(deletionCalls.length, 0)

  authResult = { error: null, data: { user: { id: user.id } } }
  const accepted = await accountApi(
    bodyRequest(
      JSON.stringify({
        confirmation: "DELETE MY ACCOUNT",
        password: "valid-password",
      })
    ),
    "delete"
  )
  assert.equal(accepted.status, 202)
  assert.deepEqual(await accepted.json(), {
    status: "pending",
    requestedAt: "2026-10-01T00:00:00.000Z",
    accepted: true,
  })
  assert.deepEqual(deletionCalls, [
    { operation: "request", owner: user.id },
    { operation: "process", owner: user.id },
  ])
  assert.equal(accepted.headers.get("cache-control"), "no-store, private")
})

test("account export is private, session-owned and serializes BigInt values", async () => {
  currentUser = user
  resetCalls()
  const response = await accountApi(
    new Request("https://jobsync.example/api/account/export"),
    "export"
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store, private")
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="jobsync-cloud-export.json"'
  )
  assert.deepEqual(await response.json(), {
    format: "jobsync-cloud-export-v1",
    usage: { reservedUnits: "3" },
  })
  assert.deepEqual(exportCalls, [user.id])
})
