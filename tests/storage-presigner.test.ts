import assert from "node:assert/strict"
import { mock, test } from "node:test"
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3"

const sent: unknown[] = []
let headMissing = false
mock.module(new URL("../lib/storage/client.ts", import.meta.url).href, {
  namedExports: {
    STORAGE_BUCKET: "jobsync-files",
    storageClient: {
      send: async (command: unknown) => {
        sent.push(command)
        if (headMissing)
          throw new S3ServiceException({
            name: "NotFound",
            $fault: "client",
            $metadata: { httpStatusCode: 404 },
          })
        return {
          ContentLength: 12,
          ContentType: "application/pdf",
          ETag: '"etag"',
        }
      },
    },
  },
})
const signed: Array<{
  command: PutObjectCommand | GetObjectCommand
  options: { expiresIn: number; signableHeaders?: Set<string> }
}> = []
mock.module("@aws-sdk/s3-request-presigner", {
  namedExports: {
    getSignedUrl: async (
      _client: unknown,
      command: PutObjectCommand | GetObjectCommand,
      options: { expiresIn: number; signableHeaders?: Set<string> }
    ) => {
      signed.push({ command, options })
      return "https://storage.example.com/ephemeral"
    },
  },
})
const { s3Transport } = await import("../lib/storage/s3-transport")
const key =
  "users/server-owner/resumes/server-resume/uploads/server-upload/original.pdf"
test("S3 signer uses exact bucket/key, bound headers and bounded expiry", async () => {
  await s3Transport.signPut(key, "application/pdf", 300)
  const put = signed[0]
  assert.ok(put.command instanceof PutObjectCommand)
  assert.deepEqual(put.command.input, {
    Bucket: "jobsync-files",
    Key: key,
    ContentType: "application/pdf",
    IfNoneMatch: "*",
  })
  assert.equal(put.options.expiresIn, 300)
  assert.deepEqual([...put.options.signableHeaders!].sort(), [
    "content-type",
    "if-none-match",
  ])
  await s3Transport.signGet(key, 60)
  const get = signed[1]
  assert.ok(get.command instanceof GetObjectCommand)
  assert.deepEqual(get.command.input, {
    Bucket: "jobsync-files",
    Key: key,
    ResponseContentDisposition: "attachment",
  })
  assert.equal(get.options.expiresIn, 60)
})
test("S3 metadata/delete boundary uses recorded key and only 404 means missing", async () => {
  assert.deepEqual(await s3Transport.head(key), {
    size: 12,
    contentType: "application/pdf",
    etag: '"etag"',
  })
  assert.ok(sent[0] instanceof HeadObjectCommand)
  assert.deepEqual(sent[0].input, { Bucket: "jobsync-files", Key: key })
  await s3Transport.remove(key)
  assert.ok(sent[1] instanceof DeleteObjectCommand)
  assert.deepEqual(sent[1].input, { Bucket: "jobsync-files", Key: key })
  headMissing = true
  assert.equal(await s3Transport.head(key), null)
})
