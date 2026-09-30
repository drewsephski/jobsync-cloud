import nextEnv from "@next/env"
import { HeadBucketCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3"
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
    const rules = cors.CORSRules ?? []
    if (
      rules.length !== 1 ||
      rules[0].AllowedOrigins?.length !== 1 ||
      rules[0].AllowedOrigins[0] !== serverEnv.APP_ORIGIN
    )
      throw new Error("CORS mismatch")
    console.log(
      "Storage smoke passed: branch bucket reachable; exact application CORS origin configured. No objects written."
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
