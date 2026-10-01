import { defineConfig } from "@neon/config/v1"

export default defineConfig({
  auth: true,
  functions: {
    resumeworker: {
      name: "Resume processing worker",
      source: "./functions/resume-worker.ts",
      externalPackages: ["unpdf", "fast-xml-parser", "mammoth"],
      env: process.env.OPENROUTER_API_KEY
        ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
        : undefined,
      dev: { port: 8787 },
    },
  },
  triggers: {
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
