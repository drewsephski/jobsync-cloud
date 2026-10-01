"use client"
import { productEventOnce } from "@/lib/analytics/client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FileUp, Loader2 } from "@/components/ui/animated-icons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import type { StructuredResume } from "@/lib/ai/resume-schema"
import { CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  MAX_RESUME_FILE_SIZE_BYTES,
  RESUME_FILE_TYPES,
} from "@/lib/storage/resume-file"

import {
  requestUploadJson as requestJson,
  resumeFileIntent,
  transferResumeFile,
  UploadRequestError,
} from "@/lib/storage/upload-client"

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
  402: "Choose an active plan in Settings to upload your resume.",
  403: "Your account cannot upload right now. Check your email verification and account status.",
  404: "This upload is no longer available. Start a new upload.",
  429: "Too many uploads are pending. Wait a moment and retry.",
  503: "File storage is temporarily unavailable. Try again shortly.",
}

function getErrorMessage(error: unknown, status?: number) {
  if (error instanceof UploadRequestError) {
    if (error.code === "email_verification_required")
      return "Verify your email address before uploading your resume."
    if (error.code === "subscription_required")
      return "An active trial or plan is required. Check your plan in Settings before uploading."
    if (error.code === "account_deleting")
      return "This account is being deleted and cannot receive new uploads."
    if (error.code === "invalid_origin")
      return "Open JobSync at its main website and retry the upload."
    if (error.code === "upload_expired")
      return "The upload link expired. Choose your file and upload it again."
    if (error.code === "upload_rejected")
      return "The uploaded file was rejected. Export a new PDF or DOCX and try again."
  }
  if (status && FRIENDLY_ERRORS[status]) return FRIENDLY_ERRORS[status]
  if (error instanceof Error && error.message === "Storage upload failed") {
    return "The private file upload did not finish. Check your connection and retry; processing starts only after the file arrives."
  }
  if (error instanceof Error && error.message === "Network request failed") {
    return "The request could not reach JobSync. Check your connection and retry."
  }
  return "The upload could not be completed. Please try again."
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
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState(
    initialUploadId
      ? "Checking your saved upload…"
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
      const deadline = Date.now() + 90_000
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
            processingFailure?: string | null
            structuring: {
              state: "processing" | "draft" | "failed"
              message: string
              draft: { data: StructuredResume } | null
            } | null
            validation: {
              state: "pending" | "valid" | "rejected"
              message: string | null
            }
          }>(`/api/resume-uploads/${encodeURIComponent(uploadId!)}`, {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
          })
          if (abort.signal.aborted) return
          if (result.processingFailure) {
            setError(result.processingFailure)
            return
          }
          if (result.validation.state === "valid") {
            productEventOnce("resume_uploaded")
            setValidated(true)
            setStatus(
              result.structuring?.message ??
                "Resume file validated. Preparing your structured draft…"
            )
            if (result.structuring?.state === "draft") {
              router.refresh()
              return
            }
            if (result.structuring?.state === "failed") {
              setError(result.structuring.message)
              return
            }
          }
          if (result.validation.state === "rejected") {
            setStatus("The resume file was rejected.")
            setError(
              result.validation.message ??
                "Start a new upload with a valid PDF or DOCX."
            )
            return
          }
        } catch (caught) {
          if (abort.signal.aborted) return
          if (
            caught instanceof UploadRequestError &&
            [400, 401, 402, 403, 404].includes(caught.status)
          ) {
            setError(getErrorMessage(caught, caught.status))
            return
          }
          setStatus(
            "We couldn’t check processing progress. We’ll retry shortly; your upload record is saved."
          )
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
  }, [uploadId, router])

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
      const intent = resumeFileIntent(file)
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
      await transferResumeFile(file, signed)

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
    <FieldGroup className="gap-4">
      <FieldGroup className="gap-2">
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
          PDF or DOCX · up to {formatSize(MAX_RESUME_FILE_SIZE_BYTES)}. We’ll
          prepare a draft for you to review.
        </CardDescription>
      </FieldGroup>

      {file ? (
        <CardDescription>
          Selected: {file.name} · {formatSize(file.size)}
        </CardDescription>
      ) : null}

      <FieldGroup className="flex-row flex-wrap gap-3">
        <Button
          type="button"
          onClick={uploadSelectedFile}
          disabled={!file || busy}
        >
          {busy ? <Loader2 className="motion-safe:animate-spin" /> : <FileUp />}
          {busy ? "Uploading…" : "Upload resume"}
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
      </FieldGroup>

      <FieldGroup
        className={
          uploadId && !error
            ? "flex-row items-start gap-3 rounded-base bg-main/5 p-4"
            : "gap-2"
        }
      >
        {uploadId && !error && (
          <Loader2
            className="mt-1 size-4 shrink-0 text-main motion-safe:animate-spin"
            aria-hidden="true"
          />
        )}
        <FieldGroup className="gap-1">
          <CardDescription role="status" aria-live="polite">
            {status}
          </CardDescription>
          {uploadId && !error && (
            <CardDescription className="text-xs">
              This usually takes a few moments. Your progress is saved, and
              nothing is accepted until you confirm it.
            </CardDescription>
          )}
        </FieldGroup>
      </FieldGroup>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Your resume needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </FieldGroup>
  )
}
