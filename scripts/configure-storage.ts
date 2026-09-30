import nextEnv from "@next/env"
import { PutBucketCorsCommand } from "@aws-sdk/client-s3"
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
try {
  const { storageClient, STORAGE_BUCKET } =
    await import("../lib/storage/client")
  const { serverEnv } = await import("../lib/server-env")
  try {
    await storageClient.send(
      new PutBucketCorsCommand({
        Bucket: STORAGE_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [serverEnv.APP_ORIGIN],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              // Both are required, signed headers of the create-only PUT request.
              AllowedHeaders: ["content-type", "if-none-match"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 300,
            },
          ],
        },
      })
    )
    console.log("Storage CORS configured for the application origin.")
  } finally {
    storageClient.destroy()
  }
} catch {
  console.error(
    "Storage configuration failed. Check server environment and bucket access."
  )
  process.exitCode = 1
}
