"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "./logo"
import { FieldGroup } from "./field"
import { LinkButton } from "./link-button"
import { ThemeToggle } from "./theme-toggle"

export function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <FieldGroup className="min-h-svh gap-0">
      <header className="border-b border-border bg-secondary-background">
        <FieldGroup className="mx-auto max-w-6xl flex-row items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <Logo className="max-[360px]:gap-1.5 max-[360px]:text-base" />
          <nav
            aria-label="Public navigation"
            className="flex shrink-0 items-center gap-2 sm:gap-4"
          >
            {pathname !== "/pricing" && (
              <Link
                href="/pricing"
                className="text-sm font-heading hover:underline max-[360px]:hidden"
              >
                Pricing
              </Link>
            )}
            <LinkButton href="/auth/sign-in" variant="neutral" size="sm">
              Sign in
            </LinkButton>
            <ThemeToggle />
          </nav>
        </FieldGroup>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-20">
        {children}
      </main>
      <footer className="border-t border-border bg-secondary-background">
        <FieldGroup className="mx-auto max-w-6xl flex-row flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-8">
          <FieldGroup className="[container-type:normal] w-full gap-3 sm:w-auto">
            <Logo />
            <span className="text-xs text-foreground/60">
              A little clarity for your next chapter.
            </span>
          </FieldGroup>
          <nav aria-label="Legal navigation" className="flex gap-5 text-sm">
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/support">Support</Link>
          </nav>
        </FieldGroup>
      </footer>
    </FieldGroup>
  )
}
