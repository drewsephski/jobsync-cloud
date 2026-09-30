import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { createSessionContext } from "../lib/auth/session-context"
import { UploadError } from "../lib/storage/upload-service"

const user = await createSessionContext(
  async () => ({ data: { user: { id: "api-owner" } }, error: null }),
  () => {
    throw new Error("redirect")
  }
).requireCurrentAuthUser()
let session: typeof user | null = user
let provisioned = 0
mock.module(new URL("../lib/auth/context.ts", import.meta.url).href, {
  namedExports: { getCurrentAuthUser: async () => session },
})
mock.module(new URL("../lib/auth/user-profile.ts", import.meta.url).href, {
  namedExports: {
    ensureUserProfile: async () => {
      provisioned++
      return { id: user.id }
    },
  },
})
mock.module(new URL("../lib/server-env.ts", import.meta.url).href, {
  namedExports: { serverEnv: { APP_ORIGIN: "http://localhost:3000" } },
})
let intentCalls = 0
mock.module(new URL("../lib/storage/uploads.ts", import.meta.url).href, {
  namedExports: {
    resumeUploads: {
      createResumeUploadIntent: async (identity: typeof user) => {
        assert.equal(identity.id, user.id)
        intentCalls++
        return { uploadId: "sanitized" }
      },
      reconcileResumeUpload: async () => {
        throw new UploadError("upload_not_found", 404)
      },
      readStatus: async () => {
        throw new UploadError("upload_not_found", 404)
      },
      createDownloadUrl: async () => {
        throw new UploadError("upload_not_found", 404)
      },
    },
  },
})
const { POST: create } = await import("../app/api/resume-uploads/route")
const { POST: complete } =
  await import("../app/api/resume-uploads/[uploadId]/complete/route")
const { POST: download } =
  await import("../app/api/resume-uploads/[uploadId]/download-url/route")
const { GET: status } =
  await import("../app/api/resume-uploads/[uploadId]/route")
const { uploadApi } = await import("../lib/storage/api")
const request = (body = "{}", origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/resume-uploads", {
    method: "POST",
    body,
    headers: { origin },
  })

test("anonymous storage endpoints return 401 without provisioning or signing", async () => {
  session = null
  const before = provisioned
  for (const call of [
    () => create(request()),
    () =>
      complete(request(), { params: Promise.resolve({ uploadId: "missing" }) }),
    () =>
      download(request(), { params: Promise.resolve({ uploadId: "missing" }) }),
    () =>
      status(new Request("http://localhost:3000/api/resume-uploads/missing"), {
        params: Promise.resolve({ uploadId: "missing" }),
      }),
  ]) {
    const response = await call()
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(provisioned, before)
  assert.equal(intentCalls, 0)
  session = user
})
test("API validates JSON and rejects cross-origin capability requests", async () => {
  assert.equal((await create(request("not-json"))).status, 400)
  assert.equal(
    (await create(request("{}", "https://attacker.example"))).status,
    403
  )
  assert.equal(intentCalls, 0)
  assert.equal((await create(request())).status, 201)
  assert.equal(intentCalls, 1)
})
test("missing/inaccessible downloads and completion preserve sanitized 404", async () => {
  for (const handler of [complete, download, status]) {
    const response = await handler(request(), {
      params: Promise.resolve({ uploadId: "missing" }),
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: "upload_not_found" })
  }
})
test("unexpected driver/provider failures never leak through API", async () => {
  const response = await uploadApi(request(), async () => {
    throw new Error("credential=private")
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "service_unavailable" })
})
