import Link from "next/link"
import { FieldGroup } from "@/components/ui/field"
import { CardDescription } from "@/components/ui/card"
import { Logo } from "@/components/ui/logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-5 py-10">
      <FieldGroup className="gap-7">
        <FieldGroup className="flex-row items-center justify-between gap-4">
          <Logo />
          <ThemeToggle />
        </FieldGroup>
        {children}
        <CardDescription className="text-center text-xs">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>{" "}
          and acknowledge our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy notice
          </Link>
          .
        </CardDescription>
      </FieldGroup>
    </main>
  )
}
