import Link from "next/link"
import { FieldGroup } from "./field"
import { LinkButton } from "./link-button"
import { ThemeToggle } from "./theme-toggle"

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <FieldGroup className="min-h-svh gap-0">
      <header className="border-b-2 border-border bg-secondary-background">
        <FieldGroup className="mx-auto max-w-6xl flex-row flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" className="text-xl font-heading tracking-tight">
            JobSync Cloud
          </Link>
          <nav
            aria-label="Public navigation"
            className="flex items-center gap-3"
          >
            <Link
              href="/pricing"
              className="text-sm font-heading hover:underline"
            >
              Pricing
            </Link>
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
      <footer className="border-t-2 border-border bg-secondary-background">
        <FieldGroup className="mx-auto max-w-6xl flex-row flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-8">
          <Link href="/" className="text-sm font-heading">
            Your job search, together.
          </Link>
          <nav aria-label="Legal navigation" className="flex gap-5 text-sm">
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </FieldGroup>
      </footer>
    </FieldGroup>
  )
}
