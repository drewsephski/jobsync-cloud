import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { STORAGE_BUCKET } from "./create-storage-client"
import { MAX_RESUME_FILE_SIZE_BYTES } from "../storage/resume-file"
import { FileValidationError } from "../validation/errors"

export function createObjectDownloader(client: S3Client) {
  return async (key: string, expectedSize: bigint) => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 20_000)
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: STORAGE_BUCKET,
          Key: key,
          Range: `bytes=0-${MAX_RESUME_FILE_SIZE_BYTES}`,
        }),
        { abortSignal: abort.signal }
      )
      if (!object.Body) throw new Error("storage_unavailable")
      const chunks: Buffer[] = []
      let length = 0
      try {
        for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
          length += chunk.byteLength
          if (length > MAX_RESUME_FILE_SIZE_BYTES) {
            abort.abort()
            throw new FileValidationError("object_too_large")
          }
          chunks.push(Buffer.from(chunk))
        }
      } finally {
        // Destroy/abort also on a short or failed stream.
        abort.abort()
      }
      if (BigInt(length) !== expectedSize)
        throw new FileValidationError("size_mismatch")
      return Buffer.concat(chunks, length)
    } finally {
      clearTimeout(timer)
    }
  }
}
