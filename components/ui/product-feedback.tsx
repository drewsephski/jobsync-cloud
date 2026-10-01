"use client"
import { useState } from "react"
import { feedbackCategories } from "@/lib/domain/feedback/schema"
import { Button } from "./button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { Field, FieldGroup, FieldLabel, FieldError } from "./field"
import { RadioGroup, RadioGroupItem } from "./radio-group"
import { Textarea } from "./textarea"
import { LinkButton } from "./link-button"

export function ProductFeedback() {
  const [category, setCategory] = useState("general")
  const [message, setMessage] = useState("")
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const submissionKey = key ?? crypto.randomUUID()
    setKey(submissionKey)
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, submissionKey }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "You’ve sent five messages today. Please try again tomorrow."
            : "Your feedback could not be sent. Your message is still here; please try again."
        )
      setSent(true)
      setMessage("")
      setKey(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          Help improve JobSync
        </CardTitle>
        <CardDescription>
          What worked, what got in your way, or what’s missing?
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <CardDescription>
            Only your selected category and the message you write are sent with
            your account ID to the operator’s private feedback queue. No resume,
            job details, notes, files, or screenshots are attached
            automatically. For private account, billing, privacy, or security
            requests, use Support.
          </CardDescription>
          {sent ? (
            <CardDescription role="status">
              Thanks. Your feedback was received privately.
            </CardDescription>
          ) : (
            <form onSubmit={submit}>
              <FieldGroup>
                <RadioGroup
                  value={category}
                  onValueChange={(value) => {
                    if (
                      typeof value === "string" &&
                      value in feedbackCategories
                    )
                      setCategory(value)
                    setKey(null)
                  }}
                  aria-label="Feedback category"
                  disabled={busy}
                >
                  {Object.entries(feedbackCategories).map(([value, label]) => (
                    <Field key={value} orientation="horizontal">
                      <RadioGroupItem id={`feedback-${value}`} value={value} />
                      <FieldLabel htmlFor={`feedback-${value}`}>
                        {label}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
                <Field>
                  <FieldLabel htmlFor="feedback-message">
                    Your feedback
                  </FieldLabel>
                  <Textarea
                    id="feedback-message"
                    required
                    minLength={10}
                    maxLength={2000}
                    value={message}
                    disabled={busy}
                    onChange={(event) => {
                      setMessage(event.target.value)
                      setKey(null)
                    }}
                    placeholder="Tell us what you’d like us to know. Include only information you choose to share."
                  />
                </Field>
                {error && <FieldError role="alert">{error}</FieldError>}
                <Button
                  className="w-fit"
                  type="submit"
                  disabled={busy || message.trim().length < 10}
                >
                  {busy ? "Sending…" : "Send feedback"}
                </Button>
              </FieldGroup>
            </form>
          )}
          <LinkButton variant="neutral" className="w-fit" href="/support">
            Support
          </LinkButton>
          <LinkButton variant="neutral" className="w-fit" href="/dashboard">
            Back to workspace
          </LinkButton>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
