import "server-only"
import type { S3Client } from "@aws-sdk/client-s3"
import { serverEnv } from "@/lib/server-env"

export { STORAGE_BUCKET } from "@/lib/backend/create-storage-client"
import { createStorageClient } from "@/lib/backend/create-storage-client"
const globalForStorage = globalThis as unknown as { storageClient?: S3Client }
export const storageClient =
  globalForStorage.storageClient ??
  createStorageClient({
    endpoint: serverEnv.AWS_ENDPOINT_URL_S3,
    region: serverEnv.AWS_REGION,
    accessKeyId: serverEnv.AWS_ACCESS_KEY_ID,
    secretAccessKey: serverEnv.AWS_SECRET_ACCESS_KEY,
  })
if (process.env.NODE_ENV !== "production")
  globalForStorage.storageClient = storageClient
