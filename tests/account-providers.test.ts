import assert from "node:assert/strict"
import { mock, test } from "node:test"

class ListObjectsV2Command {
  constructor(readonly input: Record<string, unknown>) {}
}
class DeleteObjectsCommand {
  constructor(readonly input: Record<string, unknown>) {}
}

const storageCalls: Array<{ kind: string; input: Record<string, unknown> }> = []
const storageConfigurations: Record<string, unknown>[] = []
let storageDestroyed = 0
let storageListings: Array<{ Contents?: Array<{ Key?: string }> }> = []
let storageDeleteErrors: unknown[] = []
mock.module("@aws-sdk/client-s3", {
  namedExports: { ListObjectsV2Command, DeleteObjectsCommand },
})
mock.module(
  new URL("../lib/backend/create-storage-client.ts", import.meta.url).href,
  {
    namedExports: {
      STORAGE_BUCKET: "jobsync-files",
      createStorageClient: (config: Record<string, unknown>) => {
        storageConfigurations.push(config)
        return {
          send: async (command: unknown) => {
            if (command instanceof ListObjectsV2Command) {
              storageCalls.push({ kind: "list", input: command.input })
              return storageListings.shift() ?? { Contents: [] }
            }
            assert.ok(command instanceof DeleteObjectsCommand)
            storageCalls.push({ kind: "delete", input: command.input })
            return { Errors: storageDeleteErrors }
          },
          destroy: () => {
            storageDestroyed++
          },
        }
      },
    },
  }
)

const stripeCalls: string[] = []
let stripeCandidates: Array<{ id: string; metadata: Record<string, string> }> =
  []
let stripeCustomer: {
  id: string
  deleted: boolean
  livemode: boolean
  metadata: Record<string, string>
} = {
  id: "cus_fixture",
  deleted: false,
  livemode: false,
  metadata: {
    jobsync_billing_id: "billing-row-fixture",
    jobsync_owner: "account-test-owner-1",
    jobsync_app: "cloud",
  },
}
class FakeStripe {
  constructor(
    readonly secret: string,
    readonly options: Record<string, unknown>
  ) {
    stripeCalls.push(
      `construct:${secret.startsWith("sk_test_") ? "test" : "other"}`
    )
  }
  customers = {
    list: async function* (input: Record<string, unknown>) {
      stripeCalls.push(`customer.list:${String(input.limit)}`)
      yield* stripeCandidates
    },
    retrieve: async (id: string) => {
      stripeCalls.push(`customer.retrieve:${id}`)
      return stripeCustomer
    },
    del: async (id: string) => {
      stripeCalls.push(`customer.delete:${id}`)
      return { id, deleted: true }
    },
  }
  checkout = {
    sessions: {
      list: async function* (input: Record<string, unknown>) {
        stripeCalls.push(
          `checkout.list:${String(input.customer)}:${String(input.status)}`
        )
        yield { id: "cs_open" }
      },
      retrieve: async (id: string) => {
        stripeCalls.push(`checkout.retrieve:${id}`)
        return { id, status: "open" }
      },
      expire: async (id: string) => {
        stripeCalls.push(`checkout.expire:${id}`)
        return { id, status: "expired" }
      },
    },
  }
  subscriptions = {
    list: async function* (input: Record<string, unknown>) {
      stripeCalls.push(
        `subscriptions.list:${String(input.customer)}:${String(input.status)}`
      )
      yield { id: "sub_active", status: "active" }
      yield { id: "sub_canceled", status: "canceled" }
    },
    cancel: async (id: string, options: Record<string, unknown>) => {
      stripeCalls.push(`subscription.cancel:${id}:${String(options.prorate)}`)
      return { id, status: "canceled" }
    },
  }
}
mock.module("stripe", { namedExports: { default: FakeStripe } })

const { accountCleanup } = await import("../lib/domain/account/providers")

function providerEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test" as const,
    AWS_ENDPOINT_URL_S3: "https://storage.example.test",
    AWS_REGION: "us-east-2",
    AWS_ACCESS_KEY_ID: "account-test-access",
    AWS_SECRET_ACCESS_KEY: "account-test-secret",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    NEON_ACCOUNT_CLEANUP_API_KEY: "neon-test-token",
    NEON_ACCOUNT_CLEANUP_PROJECT_ID: "project-fixture",
    NEON_ACCOUNT_CLEANUP_BRANCH_ID: "branch-fixture",
    ...extra,
  }
}

test("storage account cleanup deletes only the owner's exact prefix and handles an empty follow-up page", async () => {
  storageCalls.length = 0
  storageConfigurations.length = 0
  storageDestroyed = 0
  storageDeleteErrors = []
  const owner = "fixture_owner-1"
  const prefix = `users/${owner}/`
  storageListings = [
    {
      Contents: [
        { Key: `${prefix}resume.pdf` },
        { Key: `${prefix}nested/file.docx` },
        { Key: `users/${owner}suffix/foreign.pdf` },
      ],
    },
    { Contents: [] },
  ]
  await accountCleanup(providerEnv()).deleteFiles(owner)
  assert.equal(storageCalls.length, 3)
  assert.deepEqual(
    storageCalls.map((c) => c.kind),
    ["list", "delete", "list"]
  )
  assert.deepEqual(storageCalls[0]?.input, {
    Bucket: "jobsync-files",
    Prefix: prefix,
    MaxKeys: 1000,
  })
  assert.deepEqual(storageCalls[1]?.input, {
    Bucket: "jobsync-files",
    Delete: {
      Objects: [
        { Key: `${prefix}resume.pdf` },
        { Key: `${prefix}nested/file.docx` },
      ],
      Quiet: true,
    },
  })
  assert.equal(
    storageConfigurations[0]?.endpoint,
    "https://storage.example.test"
  )
  assert.equal(storageDestroyed, 1)
})

test("storage deletion failures stay retryable and always destroy the client", async () => {
  storageCalls.length = 0
  storageDestroyed = 0
  storageDeleteErrors = [{ Key: "private-key", Code: "AccessDenied" }]
  storageListings = [
    { Contents: [{ Key: "users/fixture_owner-2/resume.pdf" }] },
  ]
  await assert.rejects(
    accountCleanup(providerEnv()).deleteFiles("fixture_owner-2"),
    /storage_delete_failed/
  )
  assert.equal(storageDestroyed, 1)
  await assert.rejects(
    accountCleanup(providerEnv()).deleteFiles("bad/owner"),
    /invalid_owner/
  )
  storageDeleteErrors = []
  storageListings = []
})

test("Stripe cleanup verifies account provenance, expires open sessions, cancels active subscriptions, then deletes the customer", async () => {
  stripeCalls.length = 0
  stripeCustomer = {
    id: "cus_fixture",
    deleted: false,
    livemode: false,
    metadata: {
      jobsync_billing_id: "billing-row-fixture",
      jobsync_owner: "account-test-owner-1",
      jobsync_app: "cloud",
    },
  }
  await accountCleanup(providerEnv()).deleteBilling({
    id: "billing-row-fixture",
    ownerUserId: "account-test-owner-1",
    stripeCustomerId: "cus_fixture",
    livemode: false,
    checkoutSessionId: "cs_persisted",
  })
  assert.deepEqual(stripeCalls, [
    "construct:test",
    "customer.retrieve:cus_fixture",
    "checkout.list:cus_fixture:open",
    "checkout.expire:cs_open",
    "checkout.retrieve:cs_persisted",
    "checkout.expire:cs_persisted",
    "subscriptions.list:cus_fixture:all",
    "subscription.cancel:sub_active:false",
    "customer.delete:cus_fixture",
  ])
})

test("Stripe cleanup fails closed on mode and provenance mismatches", async () => {
  stripeCalls.length = 0
  await assert.rejects(
    accountCleanup(
      providerEnv({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_fixture" })
    ).deleteBilling({
      id: "billing-row-fixture",
      ownerUserId: "account-test-owner-1",
      stripeCustomerId: "cus_fixture",
      livemode: false,
      checkoutSessionId: null,
    }),
    /cleanup_billing_mode_unavailable/
  )
  assert.deepEqual(stripeCalls, [])

  stripeCustomer = {
    id: "cus_fixture",
    deleted: false,
    livemode: false,
    metadata: {
      jobsync_billing_id: "billing-row-fixture",
      jobsync_owner: "another-owner",
      jobsync_app: "cloud",
    },
  }
  await assert.rejects(
    accountCleanup(providerEnv()).deleteBilling({
      id: "billing-row-fixture",
      ownerUserId: "account-test-owner-1",
      stripeCustomerId: "cus_fixture",
      livemode: false,
      checkoutSessionId: null,
    }),
    /cleanup_billing_provenance_mismatch/
  )
  assert.equal(stripeCalls.at(-1), "customer.retrieve:cus_fixture")
})

test("Stripe customer recovery by billing metadata rejects ambiguous and foreign-owner matches", async () => {
  stripeCalls.length = 0
  stripeCustomer = {
    id: "cus_recovered",
    deleted: false,
    livemode: false,
    metadata: {
      jobsync_billing_id: "billing-row-fixture",
      jobsync_owner: "account-test-owner-1",
      jobsync_app: "cloud",
    },
  }
  stripeCandidates = [
    {
      id: "cus_recovered",
      metadata: { jobsync_billing_id: "billing-row-fixture" },
    },
  ]
  await accountCleanup(providerEnv()).deleteBilling({
    id: "billing-row-fixture",
    ownerUserId: "account-test-owner-1",
    stripeCustomerId: null,
    livemode: false,
    checkoutSessionId: null,
  })
  assert.ok(stripeCalls.includes("customer.list:100"))
  assert.ok(stripeCalls.includes("customer.retrieve:cus_recovered"))
  assert.ok(stripeCalls.includes("customer.delete:cus_recovered"))

  stripeCalls.length = 0
  stripeCandidates = [
    {
      id: "cus_recovered_a",
      metadata: { jobsync_billing_id: "billing-row-fixture" },
    },
    {
      id: "cus_recovered_b",
      metadata: { jobsync_billing_id: "billing-row-fixture" },
    },
  ]
  await assert.rejects(
    accountCleanup(providerEnv()).deleteBilling({
      id: "billing-row-fixture",
      ownerUserId: "account-test-owner-1",
      stripeCustomerId: null,
      livemode: false,
      checkoutSessionId: null,
    }),
    /cleanup_billing_provenance_ambiguous/
  )
  assert.deepEqual(stripeCalls, ["construct:test", "customer.list:100"])

  stripeCalls.length = 0
  stripeCandidates = [
    {
      id: "cus_recovered",
      metadata: { jobsync_billing_id: "billing-row-fixture" },
    },
  ]
  stripeCustomer = {
    id: "cus_recovered",
    deleted: false,
    livemode: false,
    metadata: {
      jobsync_billing_id: "billing-row-fixture",
      jobsync_owner: "another-owner",
      jobsync_app: "cloud",
    },
  }
  await assert.rejects(
    accountCleanup(providerEnv()).deleteBilling({
      id: "billing-row-fixture",
      ownerUserId: "account-test-owner-1",
      stripeCustomerId: null,
      livemode: false,
      checkoutSessionId: null,
    }),
    /cleanup_billing_provenance_mismatch/
  )
  assert.equal(stripeCalls.at(-1), "customer.retrieve:cus_recovered")
})

test("Neon Auth identity deletion treats 404 as complete and sanitizes provider failures", async () => {
  let status = 404
  let branchId = "branch-fixture"
  const requests: Array<{
    url: string
    method: string
    authorization: string | null
  }> = []
  const restore = mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      requests.push({
        url: String(input),
        method,
        authorization: new Headers(init?.headers).get("authorization"),
      })
      if (method === "GET") return Response.json({ branch: { id: branchId } })
      return new Response(null, { status })
    }
  )
  try {
    const cleanup = accountCleanup(providerEnv())
    await cleanup.deleteIdentity("fixture_owner-3")
    assert.deepEqual(
      requests.map(({ method }) => method),
      ["DELETE", "GET"]
    )
    assert.equal(
      requests[0]?.url,
      "https://console.neon.tech/api/v2/projects/project-fixture/branches/branch-fixture/auth/users/fixture_owner-3"
    )
    assert.equal(
      requests[1]?.url,
      "https://console.neon.tech/api/v2/projects/project-fixture/branches/branch-fixture"
    )
    assert.ok(
      requests.every(
        (request) => request.authorization === "Bearer neon-test-token"
      )
    )
    branchId = "another-branch"
    await assert.rejects(
      cleanup.deleteIdentity("fixture_owner-3"),
      /auth_cleanup_branch_unverified/
    )
    branchId = "branch-fixture"
    status = 503
    await assert.rejects(
      cleanup.deleteIdentity("fixture_owner-3"),
      /auth_cleanup_unavailable/
    )
  } finally {
    restore.mock.restore()
  }
})
