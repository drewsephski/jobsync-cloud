import { RESUME_FILE_TYPES, uploadIntentSchema } from "./resume-file"

export class UploadRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super("Upload request failed")
  }
}

export async function requestUploadJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      ...init,
    })
  } catch {
    throw new Error("Network request failed")
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const code =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "request_failed"
    throw new UploadRequestError(response.status, code)
  }
  return (await response.json()) as T
}

export function resumeFileIntent(file: Pick<File, "name" | "type" | "size">) {
  // Some operating systems omit MIME metadata. This is only a declaration;
  // the background validator still verifies actual bytes before accepting it.
  const inferred = Object.entries(RESUME_FILE_TYPES).find(([, extension]) =>
    file.name.toLowerCase().endsWith(`.${extension}`)
  )?.[0]
  return uploadIntentSchema.parse({
    fileName: file.name,
    contentType:
      !file.type || file.type === "application/octet-stream"
        ? inferred
        : file.type,
    sizeBytes: file.size,
  })
}

export async function transferResumeFile(
  file: File,
  signed: {
    uploadId: string
    upload: { url: string; method: "PUT"; headers: Record<string, string> }
  },
  reconcile = () =>
    requestUploadJson(
      `/api/resume-uploads/${encodeURIComponent(signed.uploadId)}/complete`,
      { method: "POST" }
    )
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response | undefined
    try {
      response = await fetch(signed.upload.url, {
        method: signed.upload.method,
        headers: signed.upload.headers,
        body: file,
        credentials: "omit",
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      // A lost response does not prove that storage rejected the bytes.
    }
    if (response?.ok) return
    try {
      await reconcile()
      return
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        [400, 401, 402, 403, 404].includes(error.status)
      )
        throw error
    }
    // Retry only transient transport failures, against the same create-only key.
    // A 412 means an object exists; never overwrite it or create another intent.
    if (
      response &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    )
      break
    if (attempt < 2)
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 500 * 2 ** attempt)
      )
  }
  throw new Error("Storage upload failed")
}
