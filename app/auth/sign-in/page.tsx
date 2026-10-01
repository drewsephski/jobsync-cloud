"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signInWithEmail } from "./actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export default function SignInForm() {
  const [state, formAction, isPending] = useActionState(signInWithEmail, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          Sign in
        </CardTitle>
        <CardDescription>
          Welcome back to your job search workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email address</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="*****"
              />
            </Field>

            {state?.error && (
              <FieldError role="alert">{state.error}</FieldError>
            )}

            <Field>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Signing in..." : "Sign In"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/auth/forgot-password" />}
        >
          Forgot password?
        </Button>
        <Button
          className="mt-6"
          variant="neutral"
          nativeButton={false}
          render={<Link href="/auth/sign-up" />}
        >
          Create an account
        </Button>
      </CardContent>
    </Card>
  )
}
