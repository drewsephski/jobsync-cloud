import { test, expect } from "@playwright/test"

test("public product story, FAQ keyboard behavior, responsive themes", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ["light", "dark"] as const) {
      await page.goto("/")
      await page.evaluate(
        (theme) => localStorage.setItem("theme", theme),
        theme
      )
      await page.reload()
      for (const route of ["/", "/pricing", "/auth/sign-up", "/auth/sign-in"]) {
        await page.goto(route)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          `${route} ${width} ${theme}`
        ).toBe(true)
        await page.screenshot({
          path: `output/playwright/public-${route.replaceAll("/", "-") || "landing"}-${width}-${theme}.png`,
          fullPage: true,
        })
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const faq = page.getByRole("button", {
    name: "Does JobSync apply to jobs for me?",
  })
  await faq.focus()
  await page.keyboard.press("Enter")
  await expect(faq).toHaveAttribute("aria-expanded", "true")
  await expect(
    page.getByText("No. You choose which roles", { exact: false })
  ).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(faq).toHaveAttribute("aria-expanded", "false")
  await page.goto("/pricing")
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation" })
      .getByRole("link", { name: "Pricing" })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", {
      name: /14 days free.*\$6\/month if it helps/,
      exact: false,
    })
  ).toBeVisible()
})
