import { defineConfig } from "@neon/config/v1"

// Explicit bindings allow an additive credential cutover before old credentials
// are revoked. Values remain provider secrets, never build artifacts or logs.
const privateRuntimeEnv = Object.fromEntries(
  [
    "DATABASE_URL",
    "AWS_ENDPOINT_URL_S3",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]!])
)

export default defineConfig({
  auth: true,
  functions: {
    accountworker: {
      name: "Private account cleanup worker",
      source: "./functions/account-worker.ts",
      env: Object.fromEntries(
        [
          "STRIPE_MODE",
          "STRIPE_SECRET_KEY",
          "STRIPE_LIVE_CLEANUP_SECRET_KEY",
          "STRIPE_TEST_CLEANUP_SECRET_KEY",
          "NEON_ACCOUNT_CLEANUP_API_KEY",
          "NEON_ACCOUNT_CLEANUP_PROJECT_ID",
          "NEON_ACCOUNT_CLEANUP_BRANCH_ID",
        ]
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]!])
          .concat(Object.entries(privateRuntimeEnv))
      ),
      dev: { port: 8789 },
    },
    discoveryworker: {
      name: "Shared job discovery worker",
      source: "./functions/discovery-worker.ts",
      env: {
        ...privateRuntimeEnv,
        STRIPE_MODE: process.env.STRIPE_MODE ?? "live",
        ...(process.env.OPENROUTER_API_KEY
          ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
          : {}),
        ...(process.env.DISCOVERY_WAKE_SECRET
          ? { DISCOVERY_WAKE_SECRET: process.env.DISCOVERY_WAKE_SECRET }
          : {}),
        // The provider merges environment updates. Explicitly clear the old
        // overlap secret so omitting it cannot preserve retired access.
        DISCOVERY_WAKE_PREVIOUS_SECRET:
          process.env.DISCOVERY_WAKE_PREVIOUS_SECRET ?? "",
      },
      dev: { port: 8788 },
    },
    resumeworker: {
      name: "Resume processing worker",
      source: "./functions/resume-worker.ts",
      externalPackages: ["unpdf", "fast-xml-parser", "mammoth"],
      env: {
        ...privateRuntimeEnv,
        STRIPE_MODE: process.env.STRIPE_MODE ?? "live",
        ...(process.env.OPENROUTER_API_KEY
          ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
          : {}),
      },
      dev: { port: 8787 },
    },
  },
  triggers: {
    "account-cleanup-recovery": {
      type: "schedule",
      function: "accountworker",
      cron: "*/5 * * * *",
      functionPath: "/recover",
      enabled: true,
    },
    "discovery-recovery": {
      type: "schedule",
      function: "discoveryworker",
      cron: "*/5 * * * *",
      functionPath: "/recover",
      enabled: true,
    },
    "resume-upload-created": {
      type: "storage_object_created",
      function: "resumeworker",
      bucket: "jobsync-files",
      prefix: "users/",
      functionPath: "/object-created",
      enabled: true,
    },
    "resume-recovery": {
      type: "schedule",
      function: "resumeworker",
      cron: "17 * * * *",
      functionPath: "/recover",
      enabled: true,
    },
  },
  buckets: {
    "jobsync-files": { access: "private" },
  },
})
