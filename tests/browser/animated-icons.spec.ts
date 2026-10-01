import { test, expect } from "@playwright/test"

test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
test.setTimeout(60_000)

test("icons animate from their whole parent link, button, and card", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const link = page.getByRole("link", { name: "Start your free trial" }).first()
  const arrow = link.locator('[data-icon="arrow-right"]')
  await expect(arrow).toBeVisible()
  const path = arrow.locator("svg path").first()
  const restingPath = await path.getAttribute("d")
  // Hover the text edge, outside the icon's hit box.
  await link.hover({ position: { x: 12, y: 12 } })
  await expect(arrow).toHaveAttribute("data-animating", "true")
  await expect
    .poll(() => path.getAttribute("d"), { intervals: [20] })
    .not.toBe(restingPath)
  await page.mouse.move(0, 0)
  await expect(arrow).toHaveAttribute("data-animating", "false")
  await expect(path).toHaveAttribute("d", restingPath!)

  await link.focus()
  await expect(arrow).toHaveAttribute("data-animating", "true")
  await link.evaluate((element: HTMLElement) => element.blur())
  await expect(arrow).toHaveAttribute("data-animating", "false")

  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Your next opportunity" })
    .first()
  const cardIcons = card.locator('[data-slot="animated-icon"]')
  await card.hover({ position: { x: 12, y: 12 } })
  for (const icon of await cardIcons.all()) {
    await expect(icon).toHaveAttribute("data-animating", "true")
  }
  await page.mouse.move(0, 0)
  for (const icon of await cardIcons.all()) {
    await expect(icon).toHaveAttribute("data-animating", "false")
  }

  const faq = page.getByRole("button", {
    name: "Does JobSync apply to jobs for me?",
  })
  const chevron = faq.locator('[data-icon="chevron-down"]')
  await faq.hover({ position: { x: 12, y: 12 } })
  await expect(chevron).toHaveAttribute("data-animating", "true")
  await faq.click()
  await expect(faq).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("link", { name: "Pricing", exact: true }).first().click()
  await expect(page).toHaveURL(/pricing/)
  expect(errors).toEqual([])
})

test("reduced motion keeps icons still on parent hover and focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const link = page.getByRole("link", { name: "Start your free trial" }).first()
  const arrow = link.locator('[data-icon="arrow-right"]')
  await expect(arrow).toBeVisible()
  const original = await arrow.locator("svg").innerHTML()
  await link.hover()
  await link.focus()
  await page.waitForTimeout(500)
  expect(await arrow.getAttribute("data-animating")).not.toBe("true")
  expect(await arrow.locator("svg").innerHTML()).toBe(original)
})
