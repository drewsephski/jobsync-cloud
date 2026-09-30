"use client"

import { useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  MAX_RESUME_FILE_SIZE_BYTES,
  RESUME_FILE_TYPES,
  uploadIntentSchema,
} from "@/lib/storage/resume-file"

type UploadIntentResponse = {
  uploadId: string
  resumeId: string
  upload: {
    url: string
    method: "PUT"
    headers: Record<string, string>
  }
  expiresAt: string
}

type DownloadResponse = {
  url: string
  expiresIn: number
}

const FRIENDLY_ERRORS: Record<number, string> = {
  400: "Choose a valid PDF or DOCX file no larger than 5 MiB.",
  401: "Your session has expired. Sign in again and retry.",
  404: "This upload is no longer available. Start a new upload.",
  429: "Too many uploads are pending. Wait a moment and retry.",
  503: "File storage is temporarily unavailable. Try again shortly.",
}

function getErrorMessage(error: unknown, status?: number) {
  if (status && FRIENDLY_ERRORS[status]) return FRIENDLY_ERRORS[status]
  if (error instanceof Error && error.message === "Network request failed") {
    return "The request could not reach JobSync. Check your connection and retry."
  }
  return "The upload could not be completed. Please try again."
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store", ...init })
  } catch {
    throw new Error("Network request failed")
  }

  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
    })
  }
  return (await response.json()) as T
}

function formatSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KiB`
    : `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

export function ResumeUpload({
  initialUploadId = null,
}: {
  initialUploadId?: string | null
}) {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState(
    initialUploadId
      ? "Upload received. Checking the file…"
      : "Choose a PDF or DOCX file to begin."
  )
  const [error, setError] = useState<string | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(initialUploadId)
  const [validated, setValidated] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!uploadId) return
    const abort = new AbortController()
    async function poll() {
      const deadline = Date.now() + 45_000
      let delay = 0
      while (!abort.signal.aborted && Date.now() < deadline) {
        if (delay)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay)
            function done() {
              clearTimeout(timer)
              abort.signal.removeEventListener("abort", done)
              resolve()
            }
            abort.signal.addEventListener("abort", done, { once: true })
          })
        if (abort.signal.aborted) return
        try {
          const result = await requestJson<{
            validation: {
              state: "pending" | "valid" | "rejected"
              message: string | null
            }
          }>(`/api/resume-uploads/${encodeURIComponent(uploadId!)}`, {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
          })
          if (abort.signal.aborted) return
          if (result.validation.state === "valid") {
            setValidated(true)
            setStatus("Resume file validated.")
            return
          }
          if (result.validation.state === "rejected") {
            setStatus("The resume file was rejected.")
            setError(
              result.validation.message ??
                "Start a new upload with a valid PDF or DOCX."
            )
            return
          }
        } catch {
          if (abort.signal.aborted) return
        }
        delay = Math.min(delay ? delay * 1.5 : 1000, 5000)
      }
      if (!abort.signal.aborted)
        setStatus(
          "Your resume is still processing. You can leave this page; processing will continue in the background."
        )
    }
    void poll()
    return () => abort.abort()
  }, [uploadId])

  function selectFile(nextFile: File | null) {
    setFile(nextFile)
    setUploadId(null)
    setValidated(false)
    setError(null)
    setStatus(
      nextFile ? "Ready to upload." : "Choose a PDF or DOCX file to begin."
    )
  }

  async function uploadSelectedFile() {
    if (!file) return
    setBusy(true)
    setError(null)
    setUploadId(null)
    setValidated(false)

    try {
      const intent = uploadIntentSchema.parse({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })
      setStatus("Preparing a private upload…")
      const signed = await requestJson<UploadIntentResponse>(
        "/api/resume-uploads",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        }
      )

      setStatus("Uploading file…")
      const putResponse = await fetch(signed.upload.url, {
        method: signed.upload.method,
        headers: signed.upload.headers,
        body: file,
        credentials: "omit",
      }).catch(() => {
        throw new Error("Network request failed")
      })
      if (!putResponse.ok) throw new Error("Upload request failed")

      setStatus("Upload received. Checking the file…")
      setUploadId(signed.uploadId)
      // A trigger may already have rejected the file. Poll its durable status
      // even if this optional transport reconciliation fails or races validation.
      try {
        await requestJson(
          `/api/resume-uploads/${encodeURIComponent(signed.uploadId)}/complete`,
          { method: "POST" }
        )
      } catch {
        // Receipt is proven by the successful PUT; background recovery continues.
      }
    } catch (caught) {
      const statusCode =
        typeof caught === "object" && caught !== null && "status" in caught
          ? Number(caught.status)
          : undefined
      const friendly =
        caught instanceof Error && caught.message.includes("5 MiB")
          ? "The file is larger than the 5 MiB upload limit."
          : caught instanceof Error && caught.name === "ZodError"
            ? "Choose a PDF or DOCX file with a matching extension, no larger than 5 MiB."
            : getErrorMessage(caught, statusCode)
      setError(friendly)
      setStatus("Upload did not finish.")
    } finally {
      setBusy(false)
    }
  }

  async function openDownload() {
    if (!uploadId) return
    setBusy(true)
    setError(null)
    try {
      const download = await requestJson<DownloadResponse>(
        `/api/resume-uploads/${encodeURIComponent(uploadId)}/download-url`,
        { method: "POST" }
      )
      window.location.assign(download.url)
    } catch (caught) {
      const statusCode =
        typeof caught === "object" && caught !== null && "status" in caught
          ? Number(caught.status)
          : undefined
      setError(getErrorMessage(caught, statusCode))
    } finally {
      setBusy(false)
    }
  }

  const accept = Object.entries(RESUME_FILE_TYPES)
    .map(([contentType, extension]) => `${contentType},.${extension}`)
    .join(",")

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="resume-file">Resume file</Label>
        <Input
          id="resume-file"
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) =>
            selectFile(event.currentTarget.files?.[0] ?? null)
          }
          aria-describedby="resume-file-help"
        />
        <CardDescription id="resume-file-help">
          PDF or DOCX · up to {formatSize(MAX_RESUME_FILE_SIZE_BYTES)}. File
          validation continues in the background after upload.
        </CardDescription>
      </div>

      {file ? (
        <CardDescription>
          Selected: {file.name} · {formatSize(file.size)}
        </CardDescription>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={uploadSelectedFile}
          disabled={!file || busy}
        >
          {busy ? "Working…" : "Upload resume"}
        </Button>
        {uploadId && validated ? (
          <Button
            type="button"
            variant="neutral"
            onClick={openDownload}
            disabled={busy}
          >
            Open uploaded file
          </Button>
        ) : null}
      </div>

      <CardDescription role="status" aria-live="polite">
        {status}
      </CardDescription>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Upload unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
