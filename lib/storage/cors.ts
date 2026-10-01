import type { CORSRule } from "@aws-sdk/client-s3"

export function storageOrigins(appOrigin: string, additional = "") {
  const origins = [
    ...new Set(
      [appOrigin, ...additional.split(",")]
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ]
  for (const origin of origins) {
    const url = new URL(origin)
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost"))
    )
      throw new Error("invalid_origin")
  }
  return origins
}

export function storageCorsRule(origins: string[]): CORSRule {
  return {
    AllowedOrigins: origins,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type", "if-none-match"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 300,
  }
}

export function verifyStorageCors(rules: CORSRule[], origins: string[]) {
  if (rules.some((rule) => rule.AllowedOrigins?.includes("*")))
    throw new Error("wildcard_origin")
  for (const origin of origins) {
    const valid = rules.some(
      (rule) =>
        rule.AllowedOrigins?.includes(origin) &&
        ["PUT", "GET", "HEAD"].every((method) =>
          rule.AllowedMethods?.includes(method)
        ) &&
        ["content-type", "if-none-match"].every((header) =>
          rule.AllowedHeaders?.map((value) => value.toLowerCase()).includes(
            header
          )
        ) &&
        rule.ExposeHeaders?.some((header) => header.toLowerCase() === "etag")
    )
    if (!valid) throw new Error("cors_mismatch")
  }
}
