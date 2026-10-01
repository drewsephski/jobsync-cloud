import { randomUUID } from "node:crypto"
import type { CurrentAuthUser } from "../../auth/session-context"
import type { ResumeUpload } from "../../generated/prisma/client"
import {
  MAX_RESUME_FILE_SIZE_BYTES,
  resumeObjectKey,
  uploadIntentSchema,
} from "../../storage/resume-file"

export const UPLOAD_URL_SECONDS = 300
export const DOWNLOAD_URL_SECONDS = 60
export class UploadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code)
  }
}
export type UploadSettlement = Pick<ResumeUpload, "status"> &
  Partial<
    Pick<
      ResumeUpload,
      | "actualContentType"
      | "actualSizeBytes"
      | "etag"
      | "uploadedAt"
      | "rejectionCode"
    >
  >
export interface UploadRepository {
  createPending(
    input: ResumeUpload,
    title: string,
    existingResume: boolean
  ): Promise<ResumeUpload>
  findOwned(id: string, ownerId: string): Promise<ResumeUpload | null>
  findByObjectKey(objectKey: string): Promise<ResumeUpload | null>
  // Atomic compare-and-set; returns the winning terminal state on concurrent calls.
  settlePending(id: string, settlement: UploadSettlement): Promise<ResumeUpload>
}
export interface UploadStorage {
  signPut(key: string, contentType: string, seconds: number): Promise<string>
  head(key: string): Promise<{
    size: number | undefined
    contentType: string | undefined
    etag: string | undefined
    lastModified?: Date
  } | null>
  remove(key: string): Promise<void>
  signGet(key: string, seconds: number): Promise<string>
}

export function createUploadService(
  repository: UploadRepository,
  storage: UploadStorage,
  now = () => new Date()
) {
  async function createResumeUploadIntent(
    user: CurrentAuthUser,
    input: unknown
  ) {
    const parsed = uploadIntentSchema.safeParse(input)
    if (!parsed.success) throw new UploadError("invalid_upload", 400)
    const metadata = parsed.data
    const id = randomUUID()
    const resumeId = metadata.resumeId ?? randomUUID()
    const createdAt = now()
    const expiresAt = new Date(createdAt.getTime() + UPLOAD_URL_SECONDS * 1000)
    const upload = await repository.createPending(
      {
        id,
        resumeId,
        ownerUserId: user.id,
        objectKey: resumeObjectKey(user.id, resumeId, id, metadata.contentType),
        originalFileName: metadata.fileName,
        declaredContentType: metadata.contentType,
        declaredSizeBytes: metadata.sizeBytes,
        actualContentType: null,
        actualSizeBytes: null,
        etag: null,
        status: "pending",
        expiresAt,
        uploadedAt: null,
        rejectionCode: null,
        validationCompletedAt: null,
        detectedFormat: null,
        contentSha256: null,
        createdAt,
        updatedAt: createdAt,
      },
      metadata.title ??
        (metadata.fileName.replace(/\.(pdf|docx)$/i, "").slice(0, 120) ||
          "Resume"),
      Boolean(metadata.resumeId)
    )
    try {
      // The row always precedes the capability. Signing failure leaves a durable
      // pending record, with the same expiry; retries create a fresh key.
      const seconds = Math.floor((expiresAt.getTime() - now().getTime()) / 1000)
      if (seconds <= 0) throw new Error("Expired signing window")
      const url = await storage.signPut(
        upload.objectKey,
        upload.declaredContentType,
        Math.min(seconds, UPLOAD_URL_SECONDS)
      )
      return {
        uploadId: id,
        resumeId,
        upload: {
          url,
          method: "PUT",
          headers: {
            "Content-Type": upload.declaredContentType,
            "If-None-Match": "*",
          },
        },
        expiresAt: expiresAt.toISOString(),
      }
    } catch {
      throw new UploadError("storage_unavailable", 503)
    }
  }

  async function owned(user: CurrentAuthUser, id: string) {
    // Avoid malformed UUID errors and preserve equivalent missing/foreign behavior.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      )
    )
      throw new UploadError("upload_not_found", 404)
    const upload = await repository.findOwned(id, user.id)
    if (!upload) throw new UploadError("upload_not_found", 404)
    return upload
  }
  function result(upload: ResumeUpload) {
    if (upload.status !== "uploaded")
      throw new UploadError(
        upload.status === "expired" ? "upload_expired" : "upload_rejected",
        400
      )
    return {
      uploadId: upload.id,
      resumeId: upload.resumeId,
      status: upload.status,
      actualSizeBytes:
        upload.actualSizeBytes === null ? null : Number(upload.actualSizeBytes),
      uploadedAt: upload.uploadedAt?.toISOString(),
    }
  }

  // Framework-independent resolution. A future trusted trigger must resolve its
  // ID/key to a DB record first; event paths never establish ownership.
  async function reconcileRecord(upload: ResumeUpload) {
    if (upload.status !== "pending") return result(upload)
    let settlement: UploadSettlement
    {
      let object: Awaited<ReturnType<UploadStorage["head"]>>
      try {
        object = await storage.head(upload.objectKey)
      } catch {
        throw new UploadError("storage_unavailable", 503)
      }
      if (!object && upload.expiresAt > now())
        throw new UploadError("object_not_uploaded", 409)
      object ??= { size: undefined, contentType: undefined, etag: undefined }
      let rejectionCode: string | null = null
      if (
        upload.expiresAt <= now() &&
        (!object.lastModified ||
          object.lastModified > upload.expiresAt ||
          object.lastModified.getTime() + 1000 < upload.createdAt.getTime())
      )
        rejectionCode = "upload_expired"
      else if (object.size === undefined || !Number.isSafeInteger(object.size))
        rejectionCode = "invalid_object_size"
      else if (object.size <= 0) rejectionCode = "empty_object"
      else if (object.size > MAX_RESUME_FILE_SIZE_BYTES)
        rejectionCode = "object_too_large"
      else if (object.size !== upload.declaredSizeBytes)
        rejectionCode = "size_mismatch"
      else if (object.contentType !== upload.declaredContentType)
        rejectionCode = "content_type_mismatch"
      settlement = {
        status:
          rejectionCode === "upload_expired"
            ? "expired"
            : rejectionCode
              ? "rejected"
              : "uploaded",
        actualSizeBytes:
          object.size !== undefined && Number.isSafeInteger(object.size)
            ? BigInt(object.size)
            : null,
        actualContentType: object.contentType ?? null,
        etag: object.etag ?? null,
        rejectionCode,
        uploadedAt: rejectionCode ? null : now(),
      }
    }
    const settled = await repository.settlePending(upload.id, settlement)
    if (settled.status === "rejected" || settled.status === "expired") {
      // Deletion is best effort. Terminal rejected/expired state remains durable
      // even if storage is unavailable; future recovery can retry cleanup.
      await storage.remove(settled.objectKey).catch(() => undefined)
    }
    return result(settled)
  }
  async function reconcileResumeUpload(user: CurrentAuthUser, id: string) {
    return reconcileRecord(await owned(user, id))
  }
  async function createDownloadUrl(user: CurrentAuthUser, id: string) {
    const upload = await owned(user, id)
    if (upload.status !== "uploaded")
      throw new UploadError("upload_not_found", 404)
    try {
      return {
        url: await storage.signGet(upload.objectKey, DOWNLOAD_URL_SECONDS),
        expiresIn: DOWNLOAD_URL_SECONDS,
      }
    } catch {
      throw new UploadError("storage_unavailable", 503)
    }
  }
  // Internal service entry for a future trusted worker, never an HTTP route.
  // The event key is only a lookup hint. All metadata/ownership comes from Postgres.
  async function reconcileStoredResumeUpload(objectKey: string) {
    const upload = await repository.findByObjectKey(objectKey)
    if (!upload) throw new UploadError("upload_not_found", 404)
    return reconcileRecord(upload)
  }
  return {
    async readStatus(user: CurrentAuthUser, id: string) {
      const upload = await owned(user, id)
      return {
        uploadId: upload.id,
        status: upload.status,
        validation: {
          state:
            upload.status === "rejected" || upload.status === "expired"
              ? "rejected"
              : upload.contentSha256
                ? "valid"
                : "pending",
          completedAt: upload.validationCompletedAt?.toISOString() ?? null,
          message:
            upload.status === "expired"
              ? "This upload expired before the file arrived. Choose your file and upload it again."
              : upload.status === "rejected"
                ? rejectionMessage(upload.rejectionCode)
                : null,
        },
      }
    },
    createResumeUploadIntent,
    reconcileResumeUpload,
    createDownloadUrl,
    reconcileStoredResumeUpload,
  }
}

function rejectionMessage(code: string | null) {
  if (code === "encrypted_pdf" || code === "encrypted_docx")
    return "Remove the password protection and upload the file again."
  if (code === "invalid_pdf")
    return "This PDF appears corrupt. Export a new PDF and try again."
  if (code === "invalid_docx")
    return "This is not a valid Word document. Save a new DOCX and try again."
  if (
    code === "docx_too_many_entries" ||
    code === "docx_uncompressed_too_large"
  )
    return "This file appears unsafe or too complex. Export a simpler document."
  return "The file could not be validated. Export a new PDF or DOCX and try again."
}
