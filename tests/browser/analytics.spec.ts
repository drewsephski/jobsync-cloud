import { test, expect } from "@playwright/test"
import { productEvents } from "../../lib/analytics/events"

test("production analytics receives only scrubbed funnel and page data", async ({
  page,
}) => {
  // Vercel deliberately suppresses automated browsers. Emulate an ordinary
  // browser only in this isolated collection/privacy test.
  await page.addInitScript(() => {
    const userAgent = navigator.userAgent.replace("HeadlessChrome", "Chrome")
    Object.defineProperty(navigator, "webdriver", { get: () => false })
    Object.defineProperty(navigator, "userAgent", { get: () => userAgent })
  })
  const canary = "private-resume-email-signed-url-canary"
  const events: {
    path: string
    body: Record<string, unknown>
    status: number
  }[] = []
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname
    // Vercel also routes collection through a generated observability base path.
    if (
      !/(?:^\/_vercel\/insights|^\/[a-f0-9]{16})\/(?:event|view)$/.test(path) ||
      response.request().method() !== "POST"
    )
      return
    const body = response.request().postDataJSON() as Record<string, unknown>
    events.push({ path, body, status: response.status() })
  })
  await page.goto(`/pricing?email=${canary}#${canary}`)
  await expect.poll(() => events.length, { timeout: 60_000 }).toBeGreaterThan(0)
  await expect
    .poll(() => events.some((e) => e.body.en === "upgrade_viewed"), {
      timeout: 60_000,
    })
    .toBe(true)
  for (const event of events) {
    expect(event.status).toBeLessThan(300)
    expect(JSON.stringify(event.body)).not.toContain(canary)
    if (event.body.en) expect(productEvents).toContain(event.body.en)
    if (event.body.p) expect(event.body.p).toEqual({})
    if (typeof event.body.o === "string")
      expect(new URL(event.body.o).search).toBe("")
  }
  console.log(
    JSON.stringify({
      analyticsReceived: true,
      privateCanaryExcluded: true,
      events: events.map((e) => e.body.en ?? "pageview"),
    })
  )
})
