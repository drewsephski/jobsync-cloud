import "server-only"
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { storageClient, STORAGE_BUCKET } from "@/lib/storage/client"
import type { UploadStorage } from "@/lib/storage/upload-service"

export const s3Transport: UploadStorage = {
  signPut: (key, contentType, expiresIn) =>
    getSignedUrl(
      storageClient,
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        ContentType: contentType,
        IfNoneMatch: "*",
      }),
      { expiresIn, signableHeaders: new Set(["content-type", "if-none-match"]) }
    ),
  signGet: (key, expiresIn) =>
    getSignedUrl(
      storageClient,
      new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        ResponseContentDisposition: "attachment",
      }),
      { expiresIn }
    ),
  async head(key) {
    try {
      const object = await storageClient.send(
        new HeadObjectCommand({ Bucket: STORAGE_BUCKET, Key: key })
      )
      return {
        size: object.ContentLength,
        contentType: object.ContentType,
        etag: object.ETag,
      }
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      )
        return null
      throw error
    }
  },
  async remove(key) {
    await storageClient.send(
      new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key })
    )
  },
}
