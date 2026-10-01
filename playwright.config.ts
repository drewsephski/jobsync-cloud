import { defineConfig } from "@playwright/test"
import nextEnv from "@next/env"
nextEnv.loadEnvConfig(process.cwd())

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "output/playwright/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
  ],
  use: {
    channel: "chrome",
    baseURL: process.env.JOBSYNC_BROWSER_ORIGIN ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
