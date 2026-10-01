"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  BriefcaseBusiness,
  Compass,
  FileText,
  Settings,
  LogOut,
} from "@/components/ui/animated-icons"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { Button } from "./button"
import { ThemeToggle } from "./theme-toggle"
import { FieldGroup } from "./field"
import { CardDescription } from "./card"
import { LinkButton } from "./link-button"
import { Logo } from "./logo"
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
  const navigationRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const settingsActive =
    pathname === "/dashboard/settings" ||
    pathname.startsWith("/dashboard/settings/") ||
    pathname === "/dashboard/billing"

  // Keep one indicator mounted and measure inside navigation so sticky/fixed
  // positioning and document scrolling do not affect the slide target.
  useLayoutEffect(() => {
    const navigation = navigationRef.current
    if (!navigation) return
    const active = navigation.querySelector<HTMLAnchorElement>(
      'a[aria-current="page"]'
    )
    const measure = () => {
      setIndicator(
        active
          ? {
              x: active.offsetLeft,
              y: active.offsetTop,
              width: active.offsetWidth,
              height: active.offsetHeight,
            }
          : null
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(navigation)
    if (active) observer.observe(active)
    return () => observer.disconnect()
  }, [pathname])

  return (
    <MotionConfig reducedMotion="user">
      <Link className="skip-link" href="#workspace">
        Skip to workspace
      </Link>
      <FieldGroup className="app-shell gap-0 lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
        <FieldGroup className="shell-sidebar gap-6 border-b border-border bg-secondary-background px-4 py-5 lg:sticky lg:top-0 lg:h-svh lg:border-r lg:border-b-0 lg:px-5 lg:py-8">
          <FieldGroup className="flex-row items-center justify-between gap-3">
            <Logo href="/dashboard" />
            <FieldGroup className="[container-type:normal] w-auto shrink-0 flex-row items-center gap-2 lg:hidden">
              <ThemeToggle />
              <LinkButton
                href="/dashboard/settings"
                variant="neutral"
                size="icon-sm"
                aria-label="Settings"
                aria-current={settingsActive ? "page" : undefined}
                className={settingsActive ? "bg-main/10 text-main" : undefined}
              >
                <Settings />
              </LinkButton>
            </FieldGroup>
          </FieldGroup>
          <nav
            ref={navigationRef}
            aria-label="Main navigation"
            className="app-navigation relative isolate grid grid-cols-4 gap-2 lg:flex lg:flex-col"
          >
            {indicator && (
              <motion.span
                data-slot="navigation-indicator"
                aria-hidden="true"
                initial={false}
                style={{ width: indicator.width, height: indicator.height }}
                animate={{ x: indicator.x, y: indicator.y }}
                transition={{
                  type: "tween",
                  duration: reduced ? 0 : 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="pointer-events-none absolute top-0 left-0 rounded-base bg-main/10"
              />
            )}
            {destinations.map(({ label, href, icon: Icon }) => {
              const active =
                href === "/dashboard"
                  ? pathname === href
                  : pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-base px-2 text-xs font-heading outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
                    active
                      ? cn("text-main", !indicator && "bg-main/10")
                      : "hover:bg-background"
                  )}
                >
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
                Continue with resume
              </LinkButton>
            )}
            <FieldGroup className="flex-row items-center justify-between gap-2">
              <LinkButton
                href="/dashboard/settings"
                variant="neutral"
                size="sm"
                aria-current={settingsActive ? "page" : undefined}
                className={settingsActive ? "bg-main/10 text-main" : undefined}
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
          className="app-workspace min-w-0 px-4 py-6 outline-none sm:px-8 lg:px-10 lg:py-10"
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
            <FieldGroup className="mt-8 flex-row flex-wrap gap-4">
              <LinkButton
                href="/dashboard/feedback"
                variant="neutral"
                size="sm"
              >
                Give feedback
              </LinkButton>
              <LinkButton href="/support" variant="neutral" size="sm">
                Support
              </LinkButton>
            </FieldGroup>
          </FieldGroup>
        </main>
      </FieldGroup>
    </MotionConfig>
  )
}
