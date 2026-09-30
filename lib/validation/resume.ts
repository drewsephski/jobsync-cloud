import { createHash } from "node:crypto"
import { MAX_RESUME_FILE_SIZE_BYTES } from "./constants"
import { FileValidationError } from "./errors"
import { validateDocx } from "./docx"
import { validatePdf } from "./pdf"
import { RESUME_FILE_TYPES } from "../storage/resume-file"

export async function validateResume(
  bytes: Buffer,
  declaredContentType: string
) {
  if (!bytes.length || bytes.length > MAX_RESUME_FILE_SIZE_BYTES)
    throw new FileValidationError("invalid_object_size")
  const format: "pdf" | "docx" | null = bytes
    .subarray(0, 5)
    .equals(Buffer.from("%PDF-"))
    ? "pdf"
    : bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50
      ? "docx"
      : null
  if (!format) throw new FileValidationError("invalid_file_signature")
  if (
    RESUME_FILE_TYPES[declaredContentType as keyof typeof RESUME_FILE_TYPES] !==
    format
  )
    throw new FileValidationError("declared_type_mismatch")
  if (format === "pdf") await validatePdf(bytes)
  else {
    try {
      validateDocx(bytes)
    } catch (error) {
      if (error instanceof FileValidationError) throw error
      throw new FileValidationError("invalid_docx")
    }
  }
  return { format, hash: createHash("sha256").update(bytes).digest("hex") }
}
