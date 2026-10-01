import nextEnv from "@next/env"
import { HeadBucketCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3"
import { storageOrigins, verifyStorageCors } from "../lib/storage/cors"
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
try {
  const { storageClient, STORAGE_BUCKET } =
    await import("../lib/storage/client")
  const { serverEnv } = await import("../lib/server-env")
  try {
    await storageClient.send(new HeadBucketCommand({ Bucket: STORAGE_BUCKET }))
    const cors = await storageClient.send(
      new GetBucketCorsCommand({ Bucket: STORAGE_BUCKET })
    )
    verifyStorageCors(
      cors.CORSRules ?? [],
      storageOrigins(serverEnv.APP_ORIGIN, process.env.STORAGE_ALLOWED_ORIGINS)
    )
    console.log(
      "Storage smoke passed: branch bucket reachable; application CORS origins, methods, and signed headers verified. No objects written."
    )
  } finally {
    storageClient.destroy()
  }
} catch {
  console.error(
    "Storage smoke failed. Check server environment, bucket, and CORS configuration."
  )
  process.exitCode = 1
}
