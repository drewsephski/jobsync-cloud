import { defineConfig } from "@neon/config/v1"

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
      ),
      dev: { port: 8789 },
    },
    discoveryworker: {
      name: "Shared job discovery worker",
      source: "./functions/discovery-worker.ts",
      env: {
        STRIPE_MODE: process.env.STRIPE_MODE ?? "live",
        ...(process.env.OPENROUTER_API_KEY
          ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
          : {}),
      },
      dev: { port: 8788 },
    },
    resumeworker: {
      name: "Resume processing worker",
      source: "./functions/resume-worker.ts",
      externalPackages: ["unpdf", "fast-xml-parser", "mammoth"],
      env: {
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
