import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const wakePayload = z
  .strictObject({
    boardId: z.uuid().optional(),
    ownerUserId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
  })
  .refine(
    (value) => value.boardId !== undefined || value.ownerUserId !== undefined
  )

const MAX_BODY_BYTES = 2_048
const MAX_SECRET_LENGTH = 256

export interface DiscoveryWakeInput {
  boardId?: string
  ownerUserId?: string
}

export interface DiscoveryWakeWorker {
  wake(input: DiscoveryWakeInput): Promise<unknown>
}

function matchesSecret(candidate: string, expected: string): boolean {
  if (
    candidate.length > MAX_SECRET_LENGTH ||
    expected.length > MAX_SECRET_LENGTH
  )
    return false
  const candidateDigest = createHash("sha256").update(candidate).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(candidateDigest, expectedDigest)
}

async function readBoundedBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error("invalid_body")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) throw new Error("body_too_large")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function createDiscoveryWakeHandler(
  getWorker: () => DiscoveryWakeWorker,
  getSecret: () => string | undefined = () => process.env.DISCOVERY_WAKE_SECRET
) {
  return async (request: Request) => {
    if (new URL(request.url).pathname !== "/wake")
      return Response.json({ error: "not_found" }, { status: 404 })
    if (request.method !== "POST")
      return Response.json({ error: "method_not_allowed" }, { status: 405 })

    const expected = getSecret()
    if (
      !expected ||
      expected.length < 32 ||
      expected.length > MAX_SECRET_LENGTH
    )
      return Response.json({ error: "wake_unavailable" }, { status: 503 })
    const authorization = request.headers.get("authorization")
    const candidate = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : ""
    if (!candidate || !matchesSecret(candidate, expected))
      return Response.json({ error: "unauthorized" }, { status: 401 })

    let input: DiscoveryWakeInput
    try {
      input = wakePayload.parse(await readBoundedBody(request))
    } catch {
      return Response.json({ error: "invalid_wake_request" }, { status: 400 })
    }

    try {
      return Response.json(await getWorker().wake(input))
    } catch {
      console.info(
        JSON.stringify({ event: "discovery_wake", status: "unavailable" })
      )
      return Response.json({ error: "wake_unavailable" }, { status: 503 })
    }
  }
}
