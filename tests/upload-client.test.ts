import assert from "node:assert/strict"
import { mock, test } from "node:test"
import {
  resumeFileIntent,
  requestUploadJson,
  transferResumeFile,
  UploadRequestError,
} from "../lib/storage/upload-client"
import {
  storageOrigins,
  storageCorsRule,
  verifyStorageCors,
} from "../lib/storage/cors"

const file = new File(["synthetic"], "resume.pdf", { type: "application/pdf" })
const signed = {
  uploadId: "same-record",
  upload: {
    url: "https://storage.example.test/object",
    method: "PUT" as const,
    headers: { "Content-Type": "application/pdf", "If-None-Match": "*" },
  },
}

test("missing MIME is inferred, but mismatched MIME and unsupported files are rejected", () => {
  assert.equal(
    resumeFileIntent({ name: "Resume.PDF", type: "", size: 12 }).contentType,
    "application/pdf"
  )
  assert.equal(
    resumeFileIntent({
      name: "resume.docx",
      type: "application/octet-stream",
      size: 12,
    }).contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
  assert.throws(() =>
    resumeFileIntent({ name: "resume.pdf", type: "text/plain", size: 12 })
  )
  assert.throws(() =>
    resumeFileIntent({ name: "resume.txt", type: "", size: 12 })
  )
})

test("lost PUT response reconciles receipt without uploading again", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new TypeError("network")
  })
  let reconciled = 0
  try {
    await transferResumeFile(file, signed, async () => {
      reconciled++
      return {}
    })
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(reconciled, 1)
  } finally {
    fetchMock.mock.restore()
  }
})

test("transient transfer retries the identical create-only capability and is bounded", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(_url, signed.upload.url)
      assert.equal(init?.body, file)
      assert.deepEqual(init?.headers, signed.upload.headers)
      return new Response(null, { status: 503 })
    }
  )
  try {
    await assert.rejects(
      transferResumeFile(file, signed, async () => {
        throw new UploadRequestError(409, "object_not_uploaded")
      }),
      /Storage upload failed/
    )
    assert.equal(fetchMock.mock.callCount(), 3)
  } finally {
    fetchMock.mock.restore()
  }
})

test("existing object is reconciled; unproven conflict is never overwritten", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 412 })
  )
  try {
    await transferResumeFile(file, signed, async () => ({}))
    await assert.rejects(
      transferResumeFile(file, signed, async () => {
        throw new UploadRequestError(503, "storage_unavailable")
      }),
      /Storage upload failed/
    )
    assert.equal(fetchMock.mock.callCount(), 2)
  } finally {
    fetchMock.mock.restore()
  }
})

test("API restrictions retain safe codes and terminal reconciliation stops retries", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "email_verification_required" }, { status: 403 })
  )
  try {
    await assert.rejects(
      requestUploadJson("/api/resume-uploads"),
      (error) =>
        error instanceof UploadRequestError &&
        error.status === 403 &&
        error.code === "email_verification_required"
    )
    await assert.rejects(
      transferResumeFile(file, signed, async () => {
        throw new UploadRequestError(400, "upload_rejected")
      }),
      (error) =>
        error instanceof UploadRequestError && error.code === "upload_rejected"
    )
    assert.equal(fetchMock.mock.callCount(), 2)
  } finally {
    fetchMock.mock.restore()
  }
})

test("CORS smoke accepts multiple exact origins and catches missing signed headers or production origin", () => {
  const origins = storageOrigins(
    "http://localhost:3000",
    " https://jobsync-cloud.vercel.app,https://jobsync-cloud.vercel.app "
  )
  assert.deepEqual(origins, [
    "http://localhost:3000",
    "https://jobsync-cloud.vercel.app",
  ])
  const rule = storageCorsRule(origins)
  verifyStorageCors([rule], origins)
  assert.throws(() =>
    verifyStorageCors([{ ...rule, AllowedHeaders: ["content-type"] }], origins)
  )
  assert.throws(() =>
    verifyStorageCors([storageCorsRule([origins[0]!])], origins)
  )
  assert.throws(() =>
    verifyStorageCors([{ ...rule, AllowedOrigins: ["*"] }], origins)
  )
  assert.throws(() =>
    storageOrigins("https://example.test", "https://example.test/path")
  )
})
