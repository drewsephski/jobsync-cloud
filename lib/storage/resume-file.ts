import { z } from "zod"

export const MAX_RESUME_FILE_SIZE_BYTES = 5 * 1024 * 1024
export const RESUME_FILE_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
} as const

export const uploadIntentSchema = z
  .strictObject({
    resumeId: z.uuid().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (name) => !/[\\/\u0000-\u001f\u007f]/.test(name),
        "Use a file name without paths or control characters"
      ),
    contentType: z.enum(
      Object.keys(RESUME_FILE_TYPES) as [
        keyof typeof RESUME_FILE_TYPES,
        ...Array<keyof typeof RESUME_FILE_TYPES>,
      ]
    ),
    sizeBytes: z.number().int().positive().max(MAX_RESUME_FILE_SIZE_BYTES),
  })
  .refine(
    (input) =>
      input.fileName
        .toLowerCase()
        .endsWith(`.${RESUME_FILE_TYPES[input.contentType]}`),
    "File extension and content type must match"
  )
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>

export function resumeObjectKey(
  ownerId: string,
  resumeId: string,
  uploadId: string,
  contentType: keyof typeof RESUME_FILE_TYPES
) {
  // IDs originate in verified auth/server UUID generation, never file metadata.
  if (
    ![ownerId, resumeId, uploadId].every((id) => /^[a-zA-Z0-9_-]+$/.test(id))
  ) {
    throw new Error("Unsafe server identifier")
  }
  return `users/${ownerId}/resumes/${resumeId}/uploads/${uploadId}/original.${RESUME_FILE_TYPES[contentType]}`
}
