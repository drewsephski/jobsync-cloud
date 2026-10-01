import nextEnv from "@next/env"
import { PutBucketCorsCommand } from "@aws-sdk/client-s3"
import { storageOrigins, storageCorsRule } from "../lib/storage/cors"
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
try {
  const { storageClient, STORAGE_BUCKET } =
    await import("../lib/storage/client")
  const { serverEnv } = await import("../lib/server-env")
  const origins = storageOrigins(
    serverEnv.APP_ORIGIN,
    process.env.STORAGE_ALLOWED_ORIGINS
  )
  try {
    await storageClient.send(
      new PutBucketCorsCommand({
        Bucket: STORAGE_BUCKET,
        CORSConfiguration: {
          CORSRules: [storageCorsRule(origins)],
        },
      })
    )
    console.log("Storage CORS configured for the explicit application origins.")
  } finally {
    storageClient.destroy()
  }
} catch {
  console.error(
    "Storage configuration failed. Check server environment and bucket access."
  )
  process.exitCode = 1
}
