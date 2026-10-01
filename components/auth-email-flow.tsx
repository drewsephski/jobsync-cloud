"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { LinkButton } from "@/components/ui/link-button"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
} from "@/components/ui/field"
export function AuthEmailFlow({
  verificationEmail,
}: {
  verificationEmail?: string
}) {
  const router = useRouter()
  const verifying = !!verificationEmail
  const [email, setEmail] = useState(verificationEmail ?? "")
  const [otp, setOtp] = useState("")
  const [password, setPassword] = useState("")
  const [sent, setSent] = useState(verifying)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function send() {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = verifying
        ? await authClient.emailOtp.sendVerificationOtp({
            email,
            type: "email-verification",
          })
        : await authClient.emailOtp.requestPasswordReset({ email })
      if (result.error && verifying)
        throw new Error(
          "Could not send a code. Please wait a moment and try again."
        )
      setSent(true)
      setMessage(
        verifying
          ? "Check your email for the verification code."
          : "If an account exists for this email, a reset code has been sent."
      )
    } catch {
      setError("Could not send a code. Please wait a moment and try again.")
    } finally {
      setPending(false)
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = verifying
        ? await authClient.emailOtp.verifyEmail({ email, otp })
        : await authClient.emailOtp.resetPassword({ email, otp, password })
      if (result.error)
        throw new Error(
          "Invalid or expired code. Request a new code and try again."
        )
      if (verifying) {
        router.push("/onboarding")
        router.refresh()
      } else {
        setMessage("Password updated. You can sign in with your new password.")
        setSent(false)
        setPassword("")
        setOtp("")
      }
    } catch {
      setError("Invalid or expired code. Request a new code and try again.")
    } finally {
      setPending(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          {verifying ? "Verify your email" : "Reset your password"}
        </CardTitle>
        <CardDescription>
          {verifying
            ? "Start your 14-day trial with a verified email address."
            : "We’ll send a reset code to your account’s email address."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email address</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              readOnly={verifying}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button
            onClick={send}
            disabled={pending || !email.includes("@")}
            variant={sent ? "neutral" : "default"}
          >
            {pending ? "Please wait…" : sent ? "Send a new code" : "Send code"}
          </Button>
          {sent && (
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="otp">Email code</FieldLabel>
                  <Input
                    id="otp"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    maxLength={12}
                  />
                </Field>
                {!verifying && (
                  <Field>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                )}
                <Button type="submit" disabled={pending}>
                  {verifying ? "Verify email" : "Update password"}
                </Button>
              </FieldGroup>
            </form>
          )}
          {message && (
            <CardDescription role="status">{message}</CardDescription>
          )}
          {error && <FieldError role="alert">{error}</FieldError>}
          <LinkButton
            variant="neutral"
            href={verifying ? "/dashboard/settings?tab=plan" : "/auth/sign-in"}
          >
            {verifying ? "Account & trial" : "Back to sign in"}
          </LinkButton>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
