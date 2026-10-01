import nextEnv from "@next/env"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")

const EXPECTED_PROJECT_ID = "lively-shape-65452824"
const EXPECTED_BRANCH_ID = "br-tiny-tree-b44fo1lv"
const EXPECTED_DB_ENDPOINT = "ep-green-scene-b45djevq"
const EXPECTED_LIVE_BRANCH = `${EXPECTED_PROJECT_ID}/${EXPECTED_BRANCH_ID}`

function check(name: string, passed: boolean, status?: number) {
  console.log({
    check: name,
    passed,
    ...(status === undefined ? {} : { status }),
  })
  if (!passed) throw new Error("Storage live proof check failed")
}

function cookieHeader(setCookies: string[]) {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ")
}

function makeSmallPdf() {
  const parts = ["%PDF-1.4\n"]
  const offsets = [0]
  for (const [id, body] of [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R /Resources << >> >>",
    ],
    [4, "<< /Length 0 >>\nstream\n\nendstream"],
  ] as const) {
    offsets[id] = Buffer.byteLength(parts.join(""), "ascii")
    parts.push(`${id} 0 obj\n${body}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(parts.join(""), "ascii")
  parts.push("xref\n0 5\n0000000000 65535 f \n")
  for (let id = 1; id <= 4; id++) {
    parts.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`)
  }
  parts.push(
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  )
  return Buffer.from(parts.join(""), "ascii")
}

async function main() {
  if (process.env.JOBSYNC_STORAGE_LIVE_BRANCH !== EXPECTED_LIVE_BRANCH) {
    throw new Error(
      "Set JOBSYNC_STORAGE_LIVE_BRANCH to the explicitly approved project/branch pair"
    )
  }

  const { serverEnv } = await import("../lib/server-env")
  const databaseUrl = new URL(serverEnv.DATABASE_URL)
  const storageEndpoint = new URL(serverEnv.AWS_ENDPOINT_URL_S3)
  check(
    "database endpoint is the confirmed isolated branch",
    new Set([
      `${EXPECTED_DB_ENDPOINT}.c-6.us-east-2.aws.neon.tech`,
      `${EXPECTED_DB_ENDPOINT}-pooler.c-6.us-east-2.aws.neon.tech`,
    ]).has(databaseUrl.hostname)
  )
  check(
    "storage endpoint is the confirmed isolated branch",
    storageEndpoint.origin ===
      `https://${EXPECTED_BRANCH_ID}.storage.c-6.us-east-2.aws.neon.tech`
  )

  const [{ db }, { storageClient, STORAGE_BUCKET }] = await Promise.all([
    import("../lib/db"),
    import("../lib/storage/client"),
  ])
  const baselineResumeCount = await db.resume.count()
  const baselineProfileCount = await db.userProfile.count()
  try {
    check("no resume rows exist before live proof", baselineResumeCount === 0)
    check(
      "only the confirmed founder profile may exist before live proof",
      baselineProfileCount <= 1
    )
    check(
      "the declared private transport bucket is selected",
      STORAGE_BUCKET === "jobsync-files"
    )
  } catch (error) {
    storageClient.destroy()
    await db.$disconnect()
    throw error
  }

  const applicationOrigin = new URL(serverEnv.APP_ORIGIN).origin
  const prefix = `storage-proof-${randomUUID()}`
  const users: Array<{ id: string; email: string }> = []
  const clientCookies = new Map<string, string>()
  let storageKey: string | undefined
  let uploadId: string | undefined
  let resumeId: string | undefined
  let proofPassed = false

  async function api(
    path: string,
    method: string,
    body?: unknown,
    asUser?: number
  ) {
    const headers = new Headers({ Origin: applicationOrigin })
    if (body !== undefined) headers.set("Content-Type", "application/json")
    const jar =
      asUser === undefined ? undefined : clientCookies.get(String(asUser))
    if (jar) headers.set("Cookie", jar)
    const response = await fetch(new URL(path, applicationOrigin), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      cache: "no-store",
    })
    if (asUser !== undefined) {
      const setCookies = response.headers.getSetCookie()
      if (setCookies.length)
        clientCookies.set(String(asUser), cookieHeader(setCookies))
    }
    return response
  }

  async function signUp(index: number) {
    const email = `${prefix}-${index}@example.com`
    const response = await api(
      "/api/auth/sign-up/email",
      "POST",
      {
        name: "JobSync storage live proof",
        email,
        password: `StorageProof-${randomUUID()}!Aa9`,
      },
      index
    )
    const result = (await response.json().catch(() => null)) as {
      user?: { id?: unknown }
    } | null
    const id = result?.user?.id
    check(
      `temporary auth user ${index} created`,
      response.ok && typeof id === "string",
      response.status
    )
    if (typeof id !== "string") throw new Error("Auth user response missing ID")
    users.push({ id, email })
  }

  try {
    const anonymousDashboard = await fetch(
      new URL("/dashboard/resume", applicationOrigin),
      {
        redirect: "manual",
        cache: "no-store",
      }
    )
    check(
      "resume dashboard redirects anonymous visitors to sign-in",
      [302, 303, 307, 308].includes(anonymousDashboard.status) &&
        anonymousDashboard.headers
          .get("location")
          ?.includes("/auth/sign-in") === true,
      anonymousDashboard.status
    )

    await signUp(0)
    await signUp(1)

    const pdf = makeSmallPdf()
    const intentResponse = await api(
      "/api/resume-uploads",
      "POST",
      {
        fileName: "live-proof.pdf",
        contentType: "application/pdf",
        sizeBytes: pdf.byteLength,
      },
      0
    )
    const intent = (await intentResponse.json().catch(() => null)) as {
      uploadId?: string
      resumeId?: string
      upload?: {
        url?: string
        method?: string
        headers?: Record<string, string>
      }
    } | null
    uploadId = intent?.uploadId
    resumeId = intent?.resumeId
    check(
      "owner receives an upload intent",
      intentResponse.status === 201,
      intentResponse.status
    )
    check(
      "upload intent carries only a bounded PUT capability",
      typeof intent?.upload?.url === "string" &&
        intent.upload.method === "PUT" &&
        intent.upload.headers?.["Content-Type"] === "application/pdf" &&
        intent.upload.headers?.["If-None-Match"] === "*"
    )
    if (!intent?.upload?.url || !uploadId || !resumeId) {
      throw new Error("Upload intent response was incomplete")
    }
    const signedPutUrl = new URL(intent.upload.url)
    check(
      "signed PUT targets the configured branch endpoint",
      signedPutUrl.origin === storageEndpoint.origin
    )

    const preflight = await fetch(signedPutUrl, {
      method: "OPTIONS",
      headers: {
        Origin: applicationOrigin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,if-none-match",
      },
    })
    const allowedMethods =
      preflight.headers.get("access-control-allow-methods")?.toUpperCase() ?? ""
    const allowedHeaders =
      preflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? ""
    check(
      "bucket CORS permits the signed browser PUT from the configured origin",
      (preflight.status === 200 || preflight.status === 204) &&
        preflight.headers.get("access-control-allow-origin") ===
          applicationOrigin &&
        allowedMethods.split(/[,\s]+/).includes("PUT") &&
        allowedHeaders.includes("content-type") &&
        allowedHeaders.includes("if-none-match"),
      preflight.status
    )

    const putHeaders = new Headers(intent.upload.headers)
    const putResponse = await fetch(signedPutUrl, {
      method: "PUT",
      headers: putHeaders,
      body: pdf,
    })
    check(
      "direct signed PUT accepts the PDF bytes",
      putResponse.status >= 200 && putResponse.status < 300,
      putResponse.status
    )

    const completePath = `/api/resume-uploads/${encodeURIComponent(uploadId)}/complete`
    const complete = await api(completePath, "POST", {}, 0)
    check(
      "server completes the uploaded object",
      complete.status === 200,
      complete.status
    )
    const repeatedComplete = await api(completePath, "POST", {}, 0)
    check(
      "completion is idempotent",
      repeatedComplete.status === 200,
      repeatedComplete.status
    )

    const persistedUpload = await db.resumeUpload.findUnique({
      where: { id: uploadId },
    })
    storageKey = persistedUpload?.objectKey
    check(
      "database records the verified actual PDF size and type",
      persistedUpload?.ownerUserId === users[0]?.id &&
        persistedUpload.status === "uploaded" &&
        persistedUpload.actualSizeBytes === BigInt(pdf.byteLength) &&
        persistedUpload.actualContentType === "application/pdf" &&
        Boolean(persistedUpload.uploadedAt) &&
        typeof storageKey === "string"
    )

    const downloadResponse = await api(
      `/api/resume-uploads/${encodeURIComponent(uploadId)}/download-url`,
      "POST",
      {},
      0
    )
    const download = (await downloadResponse.json().catch(() => null)) as {
      url?: string
    } | null
    check(
      "owner receives a fresh download URL",
      downloadResponse.status === 200 && typeof download?.url === "string",
      downloadResponse.status
    )
    if (!download?.url) throw new Error("Download URL response was incomplete")
    const downloadedResponse = await fetch(download.url, { cache: "no-store" })
    const downloadedBytes = Buffer.from(await downloadedResponse.arrayBuffer())
    check(
      "signed GET returns the original uploaded bytes",
      downloadedResponse.ok && downloadedBytes.equals(pdf),
      downloadedResponse.status
    )

    const anonymousUrl = new URL(download.url)
    anonymousUrl.search = ""
    const anonymousRead = await fetch(anonymousUrl, { cache: "no-store" })
    check(
      "private object rejects anonymous GET",
      anonymousRead.status === 403,
      anonymousRead.status
    )

    const replay = await fetch(signedPutUrl, {
      method: "PUT",
      headers: putHeaders,
      body: pdf,
    })
    check(
      "signed create-only URL rejects replay after completion",
      replay.status === 412,
      replay.status
    )
    const missingCondition = await fetch(signedPutUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    })
    check(
      "signed PUT rejects omitted If-None-Match",
      missingCondition.status === 403,
      missingCondition.status
    )
    const changedType = await fetch(signedPutUrl, {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "If-None-Match": "*",
      },
      body: pdf,
    })
    check(
      "signed PUT rejects a changed content type",
      changedType.status === 403,
      changedType.status
    )

    const userBComplete = await api(completePath, "POST", {}, 1)
    check(
      "second user cannot complete the first user's upload",
      userBComplete.status === 404,
      userBComplete.status
    )
    const userBDownload = await api(
      `/api/resume-uploads/${encodeURIComponent(uploadId)}/download-url`,
      "POST",
      {},
      1
    )
    check(
      "second user cannot get the first user's download URL",
      userBDownload.status === 404,
      userBDownload.status
    )
    const userBCreatesForResume = await api(
      "/api/resume-uploads",
      "POST",
      {
        resumeId,
        fileName: "live-proof.pdf",
        contentType: "application/pdf",
        sizeBytes: pdf.byteLength,
      },
      1
    )
    check(
      "second user cannot create an upload for the first user's resume",
      userBCreatesForResume.status === 404,
      userBCreatesForResume.status
    )

    proofPassed = true
  } finally {
    let cleanupPassed = true
    const ownerIds = users.map((user) => user.id)
    try {
      if (ownerIds.length) {
        const uploads = await db.resumeUpload.findMany({
          where: { ownerUserId: { in: ownerIds } },
          select: { objectKey: true },
        })
        if (
          storageKey &&
          !uploads.some((upload) => upload.objectKey === storageKey)
        ) {
          uploads.push({ objectKey: storageKey })
        }
        for (const upload of uploads) {
          try {
            await storageClient.send(
              new DeleteObjectCommand({
                Bucket: STORAGE_BUCKET,
                Key: upload.objectKey,
              })
            )
          } catch {
            cleanupPassed = false
          }
        }
      }
    } catch {
      cleanupPassed = false
    }
    try {
      if (ownerIds.length) {
        await db.$transaction(async (tx) => {
          await tx.resumeVersion.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.aiUsage.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.aiUsageReservation.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.processingRun.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.resumeUpload.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.resume.deleteMany({
            where: { ownerUserId: { in: ownerIds } },
          })
          await tx.userProfile.deleteMany({ where: { id: { in: ownerIds } } })
        })
      }
    } catch {
      cleanupPassed = false
    }

    for (const user of users) {
      try {
        execFileSync(
          "neon",
          [
            "neon-auth",
            "user",
            "delete",
            user.id,
            "--project-id",
            EXPECTED_PROJECT_ID,
            "--branch",
            EXPECTED_BRANCH_ID,
          ],
          { stdio: "ignore" }
        )
      } catch {
        cleanupPassed = false
      }
    }

    try {
      const finalResumeCount = await db.resume.count()
      const finalProfileCount = await db.userProfile.count()
      cleanupPassed &&=
        finalResumeCount === baselineResumeCount &&
        finalProfileCount === baselineProfileCount
    } catch {
      cleanupPassed = false
    }
    console.log({
      check:
        "only live-proof objects, rows, profiles, and auth users cleaned up",
      passed: cleanupPassed,
    })
    await storageClient.destroy()
    await db.$disconnect()
    if (!cleanupPassed) process.exitCode = 1
  }

  if (proofPassed)
    console.log({ check: "storage live proof complete", passed: true })
}

try {
  await main()
} catch {
  console.error(
    "Storage live proof failed. No request URLs, cookies, credentials, or provider responses were logged."
  )
  process.exitCode = 1
}
