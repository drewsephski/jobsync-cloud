import nextEnv from "@next/env"
import { PutBucketCorsCommand } from "@aws-sdk/client-s3"
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
try {
  const { storageClient, STORAGE_BUCKET } =
    await import("../lib/storage/client")
  const { serverEnv } = await import("../lib/server-env")
  const origins = [
    ...new Set([
      serverEnv.APP_ORIGIN,
      ...(process.env.STORAGE_ALLOWED_ORIGINS?.split(",") ?? []),
    ]),
  ]
  for (const origin of origins) {
    const url = new URL(origin)
    if (
      url.origin !== origin ||
      !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" && url.hostname !== "localhost")
    )
      throw new Error("invalid_origin")
  }
  try {
    await storageClient.send(
      new PutBucketCorsCommand({
        Bucket: STORAGE_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
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
