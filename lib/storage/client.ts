import "server-only"
import { S3Client } from "@aws-sdk/client-s3"
import { serverEnv } from "@/lib/server-env"

export const STORAGE_BUCKET = "jobsync-files"
function createStorageClient() {
  return new S3Client({
    region: serverEnv.AWS_REGION,
    endpoint: serverEnv.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: serverEnv.AWS_ACCESS_KEY_ID,
      secretAccessKey: serverEnv.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  })
}
const globalForStorage = globalThis as unknown as { storageClient?: S3Client }
export const storageClient =
  globalForStorage.storageClient ?? createStorageClient()
if (process.env.NODE_ENV !== "production")
  globalForStorage.storageClient = storageClient
