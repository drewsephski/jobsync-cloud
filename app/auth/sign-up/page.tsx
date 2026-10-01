"use client"

import { useActionState } from "react"
import Link from "next/link"
import { signUpWithEmail } from "./actions"
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
import { beginSignupMetric } from "@/lib/analytics/client"

export default function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpWithEmail, null)

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          Create your workspace
        </CardTitle>
        <CardDescription>
          Start a 14-day trial after verifying your email. No card required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} onSubmit={beginSignupMetric}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                placeholder="Your name"
              />
            </Field>

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
                autoComplete="new-password"
                minLength={12}
                required
                placeholder="At least 12 characters"
              />
            </Field>

            {state?.error && (
              <FieldError role="alert">{state.error}</FieldError>
            )}

            <Field>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating account..." : "Create Account"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        <Button
          className="mt-6"
          variant="neutral"
          nativeButton={false}
          render={<Link href="/auth/sign-in" />}
        >
          Sign in to your account
        </Button>
      </CardContent>
    </Card>
  )
}
