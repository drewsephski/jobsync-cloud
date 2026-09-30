import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { test } from "node:test"
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { createObjectDownloader } from "../lib/backend/download-object"
import { MAX_RESUME_FILE_SIZE_BYTES } from "../lib/storage/resume-file"
import { FileValidationError } from "../lib/validation/errors"
function client(chunks: Buffer[]) {
  return {
    send: async (command: GetObjectCommand) => {
      assert.equal(command.input.Bucket, "jobsync-files")
      assert.equal(command.input.Key, "persisted-key")
      assert.equal(command.input.Range, `bytes=0-${MAX_RESUME_FILE_SIZE_BYTES}`)
      return { Body: Readable.from(chunks) }
    },
  } as unknown as S3Client
}
test("download uses stored key, bounded range and exact persisted size", async () => {
  const download = createObjectDownloader(client([Buffer.from("valid bytes")]))
  assert.equal(
    (await download("persisted-key", BigInt(11))).toString(),
    "valid bytes"
  )
  await assert.rejects(
    download("persisted-key", BigInt(10)),
    (error) =>
      error instanceof FileValidationError && error.code === "size_mismatch"
  )
})
test("sentinel byte rejects oversized body before concatenating it", async () => {
  const download = createObjectDownloader(
    client([Buffer.alloc(MAX_RESUME_FILE_SIZE_BYTES + 1)])
  )
  await assert.rejects(
    download("persisted-key", BigInt(MAX_RESUME_FILE_SIZE_BYTES)),
    (error) =>
      error instanceof FileValidationError && error.code === "object_too_large"
  )
})
