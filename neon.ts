import { defineConfig } from "@neon/config/v1"

export default defineConfig({
  auth: true,
  functions: {
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
