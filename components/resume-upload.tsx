"use client"

import { useState } from "react"
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

type CompleteResponse = {
  status: "uploaded"
  actualSizeBytes: number
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

export function ResumeUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState("Choose a PDF or DOCX file to begin.")
  const [error, setError] = useState<string | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function selectFile(nextFile: File | null) {
    setFile(nextFile)
    setUploadId(null)
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

      setStatus("Verifying uploaded file…")
      const completed = await requestJson<CompleteResponse>(
        `/api/resume-uploads/${encodeURIComponent(signed.uploadId)}/complete`,
        { method: "POST" }
      )
      if (completed.status !== "uploaded")
        throw new Error("Upload was not accepted")

      setUploadId(signed.uploadId)
      setStatus(`Upload complete · ${formatSize(completed.actualSizeBytes)}`)
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
          PDF or DOCX · up to {formatSize(MAX_RESUME_FILE_SIZE_BYTES)}.
          Transport checks only; file content validation is deferred.
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
        {uploadId ? (
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
