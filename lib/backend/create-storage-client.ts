import { S3Client } from "@aws-sdk/client-s3"

export const STORAGE_BUCKET = "jobsync-files"
export function createStorageClient(config: {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestHandler: { connectionTimeout: 5000, requestTimeout: 20_000 },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  })
}
