"use client"

import { Moon, Sun } from "@/components/ui/animated-icons"
import { useTheme } from "next-themes"
import { Button } from "./button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="neutral"
      size="icon-sm"
      aria-label="Toggle color theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  )
}
