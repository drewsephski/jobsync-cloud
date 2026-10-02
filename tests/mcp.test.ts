import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createSessionContext } from "../lib/auth/session-context"
import {
  createMcpTokenService,
  resolveMcpToken,
  tokenDigest,
  bearerToken,
} from "../lib/mcp/tokens"
import { createMcpHandler } from "../lib/mcp/http"
import { mcpClientConfigs } from "../lib/mcp/config"
import { editableContent } from "../lib/domain/onboarding/schema"
import { createAccountDeletion } from "../lib/domain/account/deletion"
import { sanitizedResume } from "./resume-structure-fixtures"
import { trialFields } from "./billing-fixtures"

nextEnv.loadEnvConfig(process.cwd())
const { db } = await import("../lib/db")
after(() => db.$disconnect())
const service = createMcpTokenService(db)
const origin = "https://jobsync.example.test"
const handler = createMcpHandler(db, origin)
async function fixture() {
  const owner = `mcp-${randomUUID()}`,
    other = `mcp-${randomUUID()}`
  await db.userProfile.createMany({
    data: [owner, other].map((id) => ({
      id,
      ...trialFields(),
      timezone: "America/Chicago",
      onboardingCompletedAt: new Date(),
    })),
  })
  const user = (id: string) =>
    createSessionContext(
      async () => ({ data: { user: { id } }, error: null }),
      () => {
        throw new Error("unexpected redirect")
      }
    ).requireCurrentAuthUser()
  return {
    owner,
    other,
    user: await user(owner),
    otherUser: await user(other),
    async cleanup() {
      const where = { ownerUserId: { in: [owner, other] } }
      await db.application.deleteMany({ where })
      await db.resume.updateMany({
        where,
        data: { confirmedVersionId: null, confirmedAt: null },
      })
      await db.resumeVersion.updateMany({
        where,
        data: { originDraftId: null },
      })
      await db.resumeVersion.deleteMany({ where })
      await db.resumeUpload.deleteMany({ where })
      await db.processingRun.deleteMany({ where })
      await db.resume.deleteMany({ where })
      await db.userProfile.deleteMany({ where: { id: { in: [owner, other] } } })
      await db.accountDeletionRequest.deleteMany({ where })
    },
  }
}
async function client(token: string) {
  const value = new Client({ name: "mcp-test", version: "1.0" })
  await value.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => {
        const request = new Request(url, init)
        return request.method === "GET"
          ? new Response(null, { status: 405 })
          : handler(request)
      },
    })
  )
  return value
}
async function call(
  c: Client,
  name: string,
  args: Record<string, unknown> = {}
) {
  const result = await c.callTool({ name, arguments: args })
  const content = result.content as { type: string; text?: string }[]
  assert.equal(content[0].type, "text")
  return {
    failed: result.isError === true,
    value: content[0].text!.startsWith("{")
      ? JSON.parse(content[0].text!)
      : { error: content[0].text },
  }
}
const details = {
  company: "Acme",
  title: "Staff Engineer",
  location: "Chicago",
  postingUrl: null,
  salary: null,
  notes: "Prepare",
  appliedOn: null,
  followUpOn: "2026-09-30",
  nextAction: "Follow up",
  resumeVersionId: null,
}

test("opaque tokens are scoped, hashed, expiring, owner-qualified, and durably rate limited", async () => {
  const f = await fixture()
  try {
    const issued = await service.create(f.user, {
      name: "Codex",
      expiresInDays: 30,
      scopes: ["workspace:read"],
    })
    assert.match(issued.token, /^jsc_[A-Za-z0-9_-]{43}$/)
    assert.equal(
      bearerToken(
        new Request(origin, {
          headers: { Authorization: `Bearer ${issued.token}` },
        })
      ),
      issued.token
    )
    assert.equal(
      bearerToken(
        new Request(origin, { headers: { Authorization: "Bearer invalid" } })
      ),
      null
    )
    const stored = await db.mcpAccessToken.findUniqueOrThrow({
      where: { tokenHash: tokenDigest(issued.token) },
    })
    assert.notEqual(stored.tokenHash, issued.token)
    assert.ok(!JSON.stringify(issued.tokens).includes("tokenHash"))
    assert.ok(!JSON.stringify(issued.tokens).includes(issued.token))
    assert.equal((await resolveMcpToken(db, issued.token)).user.id, f.owner)
    await assert.rejects(service.revoke(f.otherUser, { tokenId: stored.id }), {
      code: "token_not_found",
    })
    await db.mcpAccessToken.update({
      where: { id: stored.id },
      data: { rateCount: 119, rateWindowAt: new Date() },
    })
    const concurrent = await Promise.allSettled(
      Array.from({ length: 3 }, () => resolveMcpToken(db, issued.token))
    )
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1)
    await db.mcpAccessToken.update({
      where: { id: stored.id },
      data: { rateWindowAt: new Date(Date.now() - 120000) },
    })
    await resolveMcpToken(db, issued.token)
    await service.revoke(f.user, { tokenId: stored.id })
    await assert.rejects(resolveMcpToken(db, issued.token), {
      code: "invalid_token",
    })
    const expired = await service.create(f.user, {
      name: "Expired",
      expiresInDays: 30,
      scopes: ["workspace:read"],
    })
    await db.mcpAccessToken.update({
      where: { tokenHash: tokenDigest(expired.token) },
      data: { expiresAt: new Date(0) },
    })
    await assert.rejects(resolveMcpToken(db, expired.token), {
      code: "invalid_token",
    })
    const deleting = await service.create(f.user, {
      name: "Deleting",
      expiresInDays: 30,
      scopes: ["workspace:read"],
    })
    await createAccountDeletion(db, {
      deleteFiles: async () => {},
      deleteBilling: async () => {},
      deleteIdentity: async () => {},
    }).request(f.owner)
    assert.ok(
      (
        await db.mcpAccessToken.findUniqueOrThrow({
          where: { tokenHash: tokenDigest(deleting.token) },
        })
      ).revokedAt
    )
    await assert.rejects(resolveMcpToken(db, deleting.token), {
      code: "invalid_token",
    })
    await assert.rejects(
      service.create(f.user, {
        name: "Denied",
        expiresInDays: 30,
        scopes: ["workspace:read"],
      }),
      { code: "account_deleting" }
    )
  } finally {
    await f.cleanup()
  }
})

test("official HTTP client exercises application lifecycle, approvals, revisions, pagination, and tenant isolation", async () => {
  const f = await fixture()
  let c: Client | undefined, other: Client | undefined, read: Client | undefined
  try {
    const issue = (user: typeof f.user, scopes: string[]) =>
      service.create(user, { name: "MCP test", expiresInDays: 90, scopes })
    const issued = await issue(f.user, ["workspace:read", "applications:write"])
    c = await client(issued.token)
    other = await client(
      (await issue(f.otherUser, ["workspace:read", "applications:write"])).token
    )
    read = await client((await issue(f.user, ["workspace:read"])).token)
    const tools = (await read.listTools()).tools.map((t) => t.name)
    assert.ok(tools.includes("get_application"))
    assert.ok(!tools.includes("create_application"))
    const input = {
      creationKey: randomUUID(),
      details,
      status: "saved",
      stageName: null,
    }
    assert.equal((await call(c, "create_application", input)).failed, true)
    const created = await call(c, "create_application", {
      ...input,
      userApproved: true,
    })
    assert.equal(created.failed, false)
    const id = created.value.applicationId
    assert.equal(
      (await call(c, "create_application", { ...input, userApproved: true }))
        .value.created,
      false
    )
    assert.equal(
      (await call(other, "get_application", { applicationId: id })).value.error,
      "application_not_found"
    )
    assert.equal(
      (
        await call(other, "edit_application", {
          applicationId: id,
          expectedRevision: 0,
          details,
          userApproved: true,
        })
      ).value.error,
      "application_not_found"
    )
    const transition = {
      applicationId: id,
      expectedRevision: 0,
      status: "applied",
      stageName: null,
      occurredOn: "2026-09-30",
      note: "User reported applying",
      userApproved: true,
    }
    assert.equal(
      (await call(c, "transition_application", transition)).failed,
      false
    )
    assert.equal(
      (await call(c, "transition_application", transition)).value.error,
      "application_conflict"
    )
    const detail = (await call(c, "get_application", { applicationId: id }))
      .value.application
    assert.equal(detail.revision, 1)
    assert.equal(detail.events.length, 2)
    assert.equal((await call(c, "get_dashboard")).value.dueCount, 1)
    await call(c, "create_application", {
      ...input,
      creationKey: randomUUID(),
      userApproved: true,
    })
    const first = (
      await call(c, "list_applications", { query: "acme", limit: 1 })
    ).value
    assert.equal(first.applications.length, 1)
    assert.equal(first.nextOffset, 1)
    assert.equal(
      (
        await call(c, "list_applications", {
          offset: first.nextOffset,
          limit: 1,
        })
      ).value.nextOffset,
      null
    )
    assert.equal(
      (await call(other, "list_applications")).value.applications.length,
      0
    )
    assert.equal(
      (
        await call(c, "archive_application", {
          applicationId: id,
          expectedRevision: 1,
          archived: true,
          userApproved: true,
        })
      ).failed,
      false
    )
    assert.equal(
      (
        await call(c, "edit_application", {
          applicationId: id,
          expectedRevision: 2,
          details,
          userApproved: true,
        })
      ).value.error,
      "application_archived"
    )
    const expiredRead = new Date(Date.now() - 1000)
    await db.userProfile.update({
      where: { id: f.owner },
      data: { trialEndsAt: expiredRead },
    })
    const savedRollout = process.env.BILLING_ROLLOUT_READY
    const savedMode = process.env.STRIPE_MODE
    process.env.BILLING_ROLLOUT_READY = "true"
    process.env.STRIPE_MODE = "live"
    try {
      assert.equal(
        (
          await call(c, "create_application", {
            ...input,
            creationKey: randomUUID(),
            userApproved: true,
          })
        ).value.error,
        "subscription_required"
      )
      assert.equal(
        (await call(read, "get_application", { applicationId: id })).failed,
        false
      )
    } finally {
      if (savedRollout === undefined) delete process.env.BILLING_ROLLOUT_READY
      else process.env.BILLING_ROLLOUT_READY = savedRollout
      if (savedMode === undefined) delete process.env.STRIPE_MODE
      else process.env.STRIPE_MODE = savedMode
    }
    await service.revoke(f.user, { tokenId: issued.tokens[0].id })
    await assert.rejects(c.listTools())
  } finally {
    await c?.close()
    await other?.close()
    await read?.close()
    await f.cleanup()
  }
})

test("resume reads exclude capabilities; edits make immutable drafts and confirmation stays explicit", async () => {
  const f = await fixture()
  let c: Client | undefined
  try {
    c = await client(
      (
        await service.create(f.user, {
          name: "Resume test",
          expiresInDays: 30,
          scopes: ["workspace:read", "resumes:write", "applications:write"],
        })
      ).token
    )
    const resume = await db.resume.create({
      data: { ownerUserId: f.owner, title: "Resume" },
    })
    const otherResume = await db.resume.create({
      data: { ownerUserId: f.other, title: "Private" },
    })
    const upload = await db.resumeUpload.create({
      data: {
        ownerUserId: f.owner,
        resumeId: resume.id,
        objectKey: `private/${randomUUID()}`,
        originalFileName: "resume.pdf",
        declaredContentType: "application/pdf",
        declaredSizeBytes: 128,
        status: "uploaded",
        expiresAt: new Date(Date.now() + 60000),
        contentSha256: "a".repeat(64),
        actualContentType: "application/pdf",
        actualSizeBytes: BigInt(128),
        uploadedAt: new Date(),
        validationCompletedAt: new Date(),
        detectedFormat: "pdf",
      },
    })
    const run = await db.processingRun.create({
      data: {
        ownerUserId: f.owner,
        kind: "resume-structure",
        resourceId: upload.id,
        idempotencyKey: `mcp-test-${randomUUID()}`,
        status: "succeeded",
      },
    })
    const original = await db.resumeVersion.create({
      data: {
        ownerUserId: f.owner,
        resumeId: resume.id,
        version: 1,
        source: "upload",
        status: "ready",
        sourceUploadId: upload.id,
        sourceSha256: "a".repeat(64),
        processingRunId: run.id,
        extractionVersion: "test-extract-v1",
        promptVersion: "test-prompt-v1",
        schemaVersion: "resume-v1",
        data: structuredClone(sanitizedResume),
        storageObjectKey: `private/${randomUUID()}`,
      },
    })
    const otherVersion = await db.resumeVersion.create({
      data: {
        ownerUserId: f.other,
        resumeId: otherResume.id,
        version: 1,
        source: "manual",
        status: "ready",
        data: structuredClone(sanitizedResume),
      },
    })
    assert.equal((await call(c, "list_resumes")).value.resumes.length, 1)
    assert.equal(
      (await call(c, "get_resume", { resumeId: otherResume.id })).value.error,
      "resume_not_found"
    )
    assert.equal(
      (
        await call(c, "get_resume", {
          resumeId: resume.id,
          versionId: otherVersion.id,
        })
      ).value.error,
      "resume_version_not_found"
    )
    const output = await call(c, "get_resume", { resumeId: resume.id })
    assert.ok(!JSON.stringify(output).includes("storageObjectKey"))
    assert.ok(!JSON.stringify(output).includes(upload.objectKey))
    const data = editableContent(sanitizedResume)
    data.summary = "Explicit user edit"
    const saved = await call(c, "save_resume_draft", {
      expectedVersionId: original.id,
      data,
      userApproved: true,
    })
    assert.equal(saved.failed, false)
    assert.notEqual(saved.value.version.id, original.id)
    assert.equal(saved.value.version.confirmed, false)
    assert.deepEqual(
      (await db.resumeVersion.findUniqueOrThrow({ where: { id: original.id } }))
        .data,
      sanitizedResume
    )
    assert.equal(
      (
        await call(c, "save_resume_draft", {
          expectedVersionId: original.id,
          data,
          userApproved: true,
        })
      ).value.error,
      "version_conflict"
    )
    assert.equal(
      (
        await call(c, "confirm_resume", {
          expectedVersionId: saved.value.version.id,
        })
      ).failed,
      true
    )
    assert.equal(
      (
        await call(c, "confirm_resume", {
          expectedVersionId: saved.value.version.id,
          userApproved: true,
        })
      ).value.version.confirmed,
      true
    )
    assert.equal(
      (await call(c, "get_resume", { resumeId: resume.id })).value.confirmed,
      true
    )
    assert.equal(
      (
        await db.resumeVersion.findUniqueOrThrow({
          where: { id: saved.value.version.id },
        })
      ).status,
      "ready"
    )
    assert.equal(
      (
        await call(c, "create_application", {
          userApproved: true,
          creationKey: randomUUID(),
          status: "saved",
          stageName: null,
          details: { ...details, resumeVersionId: saved.value.version.id },
        })
      ).failed,
      false
    )
  } finally {
    await c?.close()
    await f.cleanup()
  }
})

test("HTTP boundary rejects cookie-only auth, foreign origins/hosts, oversized requests, and hides internal errors", async () => {
  const f = await fixture()
  try {
    const token = (
      await service.create(f.user, {
        name: "HTTP",
        expiresInDays: 30,
        scopes: ["workspace:read"],
      })
    ).token
    const req = (headers: Record<string, string>, body = "{}", url = origin) =>
      new Request(`${url}/api/mcp`, { method: "POST", headers, body })
    const unauthorized = await handler(req({ Cookie: "session=irrelevant" }))
    assert.equal(unauthorized.status, 401)
    assert.equal(unauthorized.headers.get("cache-control"), "no-store")
    assert.ok(unauthorized.headers.get("www-authenticate"))
    assert.equal(
      (
        await handler(
          req({
            Authorization: `Bearer ${token}`,
            Origin: "https://attacker.test",
          })
        )
      ).status,
      403
    )
    assert.equal(
      (
        await handler(
          req(
            { Authorization: `Bearer ${token}` },
            "{}",
            "https://attacker.test"
          )
        )
      ).status,
      403
    )
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    assert.equal((await handler(req(headers, " ".repeat(256001)))).status, 413)
    assert.equal((await handler(req(headers, "not json"))).status, 400)
    const configs = mcpClientConfigs(origin, token)
    assert.equal(
      JSON.parse(configs.remote).mcpServers.jobsync.url,
      `${origin}/api/mcp`
    )
    assert.ok(
      configs.codex.includes('bearer_token_env_var = "JOBSYNC_MCP_TOKEN"')
    )
  } finally {
    await f.cleanup()
  }
})
