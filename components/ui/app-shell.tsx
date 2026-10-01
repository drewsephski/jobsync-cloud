"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  BriefcaseBusiness,
  Compass,
  FileText,
  Settings,
  LogOut,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { Button } from "./button"
import { ThemeToggle } from "./theme-toggle"
import { FieldGroup } from "./field"
import { CardDescription } from "./card"
import { LinkButton } from "./link-button"
import { Badge } from "./badge"
import { cn } from "@/lib/utils"
import { signOut } from "@/app/auth/actions"

const destinations = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Jobs", href: "/dashboard/jobs", icon: BriefcaseBusiness },
  { label: "Discover", href: "/dashboard/discover", icon: Compass },
  { label: "Resume", href: "/dashboard/resume", icon: FileText },
]

export function AppShell({
  children,
  planLabel,
  name,
  complete,
}: {
  children: React.ReactNode
  planLabel: string
  name: string
  complete: boolean
}) {
  const pathname = usePathname()
  const reduced = useReducedMotion()
  return (
    <MotionConfig reducedMotion="user">
      <Link className="skip-link" href="#workspace">
        Skip to workspace
      </Link>
      <FieldGroup className="app-shell gap-0 lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
        <FieldGroup className="shell-sidebar gap-6 border-b-2 border-border bg-secondary-background px-4 py-5 lg:sticky lg:top-0 lg:h-svh lg:border-r-2 lg:border-b-0 lg:px-5 lg:py-8">
          <FieldGroup className="flex-row items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="text-xl font-heading tracking-tight"
            >
              JobSync{" "}
              <Badge variant="neutral" className="text-[10px]">
                Cloud
              </Badge>
            </Link>
            <FieldGroup className="[container-type:normal] w-auto shrink-0 flex-row items-center gap-2 lg:hidden">
              <ThemeToggle />
              <LinkButton
                href="/dashboard/settings"
                variant="neutral"
                size="icon-sm"
                aria-label="Settings"
              >
                <Settings />
              </LinkButton>
            </FieldGroup>
          </FieldGroup>
          <nav
            aria-label="Main navigation"
            className="grid grid-cols-4 gap-2 lg:flex lg:flex-col"
          >
            {destinations.map(({ label, href, icon: Icon }) => {
              const active =
                href === "/dashboard"
                  ? pathname === href
                  : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-base px-2 text-xs font-heading outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
                    active ? "text-main-foreground" : "hover:bg-background"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="active-navigation"
                      transition={{ duration: reduced ? 0 : 0.18 }}
                      className="absolute inset-0 rounded-base border-2 border-border bg-main"
                    />
                  )}
                  <Icon className="relative size-4" />
                  <span className="relative">{label}</span>
                </Link>
              )
            })}
          </nav>
          <FieldGroup className="hidden min-w-0 gap-4 lg:mt-auto lg:flex">
            <CardDescription className="break-words">{name}</CardDescription>
            <CardDescription className="text-xs">{planLabel}</CardDescription>
            {!complete && (
              <LinkButton href="/onboarding" size="sm">
                Finish setup
              </LinkButton>
            )}
            <FieldGroup className="flex-row items-center justify-between gap-2">
              <LinkButton
                href="/dashboard/settings"
                variant="neutral"
                size="sm"
                aria-current={
                  pathname.startsWith("/dashboard/settings")
                    ? "page"
                    : undefined
                }
              >
                <Settings /> Settings
              </LinkButton>
              <ThemeToggle />
            </FieldGroup>
            <form action={signOut}>
              <Button
                variant="neutral"
                size="sm"
                type="submit"
                className="w-full"
              >
                <LogOut /> Sign out
              </Button>
            </form>
            <FieldGroup className="flex-row gap-4">
              <Link
                href="/privacy"
                className="text-xs underline underline-offset-4"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-xs underline underline-offset-4"
              >
                Terms
              </Link>
            </FieldGroup>
          </FieldGroup>
        </FieldGroup>
        <main
          id="workspace"
          tabIndex={-1}
          className="min-w-0 px-4 py-6 outline-none sm:px-8 lg:px-10 lg:py-10"
        >
          <FieldGroup className="mx-auto w-full max-w-6xl gap-0">
            <CardDescription className="mb-6 text-xs lg:hidden">
              {planLabel}
            </CardDescription>
            <motion.div
              key={pathname}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
            >
              {children}
            </motion.div>
          </FieldGroup>
        </main>
      </FieldGroup>
    </MotionConfig>
  )
}
