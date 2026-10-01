"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Plus, Trash2 } from "@/components/ui/animated-icons"
import type { OnboardingState } from "@/lib/domain/onboarding/service"
import { preferencesSchema } from "@/lib/domain/onboarding/schema"
import {
  onboardingError,
  onboardingRequest,
  OnboardingRequestError,
} from "./onboarding-api"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export function TargetPreferences({
  initialState,
  onReview,
  onSaved,
}: {
  initialState: OnboardingState
  onReview: () => void
  onSaved: (state: OnboardingState) => void
}) {
  const router = useRouter()
  const state = initialState
  const [titles, setTitles] = useState(
    initialState.targets.length
      ? initialState.targets.map((target) => target.targetTitle)
      : [
          initialState.version?.data.employment.find((entry) =>
            entry.title?.trim()
          )?.title ?? "",
        ]
  )
  const first = initialState.targets[0]
  const [location, setLocation] = useState(first?.location ?? "")
  const [remote, setRemote] = useState(
    first?.remotePreferred === true
      ? "remote"
      : first?.remotePreferred === false
        ? "onsite"
        : "any"
  )
  const [compensation, setCompensation] = useState(
    first?.minimumCompensationUsd?.toString() ?? ""
  )
  const [keywords, setKeywords] = useState(first?.keywords.join(", ") ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState("")
  const draftTargets = titles.map((targetTitle) => ({
    targetTitle: targetTitle.trim(),
    location: location.trim() || null,
    remotePreferred: remote === "any" ? null : remote === "remote",
    minimumCompensationUsd: compensation.trim() ? Number(compensation) : null,
    keywords: keywords
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }))
  const canonical = (targets: typeof draftTargets) =>
    JSON.stringify(
      [...targets].sort((a, b) => a.targetTitle.localeCompare(b.targetTitle))
    )
  const meaningful =
    titles.some((title) => title.trim()) ||
    location.trim() ||
    remote !== "any" ||
    compensation.trim() ||
    keywords.trim()
  const dirty =
    !!(meaningful || state.targets.length) &&
    canonical(draftTargets) !== canonical(state.targets)
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])
  async function save(complete: boolean) {
    const input = {
      expectedVersionId: state.version!.id,
      expectedRevision: state.preferenceRevision,
      complete,
      targets: draftTargets,
    }
    if (!preferencesSchema.safeParse(input).success) {
      setError(
        "Add 1–10 distinct target titles. Salary must be a whole annual USD amount from 0 to 10,000,000. Use up to 30 keywords."
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice("")
    try {
      const next = await onboardingRequest("preferences", input)
      if (complete) {
        router.replace("/dashboard/discover")
        router.refresh()
      } else {
        onSaved(next)
        setNotice("Preferences saved. You can return on any device to finish.")
      }
    } catch (caught) {
      setError(onboardingError(caught))
      setConflict(
        caught instanceof OnboardingRequestError && caught.status === 409
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldSet disabled={busy}>
      <FieldGroup className="gap-7">
        <Alert className="review-guidance">
          <AlertTitle>Your resume is confirmed</AlertTitle>
          <AlertDescription>
            Choose a starting role below. You can change it and refine locations
            later in Discover.
          </AlertDescription>
        </Alert>
        <FieldGroup className="gap-3">
          <CardTitle role="heading" aria-level={2}>
            Which roles are you looking for?
          </CardTitle>
          <CardDescription>
            We suggest a title from your confirmed experience when available.
            Keep it or choose what you want next.
          </CardDescription>
          {titles.map((title, index) => (
            <FieldGroup key={index} className="flex-row items-end gap-2">
              <Field>
                <FieldLabel htmlFor={`target-title-${index}`}>
                  Target title {index + 1}
                </FieldLabel>
                <Input
                  id={`target-title-${index}`}
                  value={title}
                  maxLength={120}
                  placeholder="e.g. Product designer"
                  onChange={(event) =>
                    setTitles(
                      titles.map((value, i) =>
                        i === index ? event.target.value : value
                      )
                    )
                  }
                />
              </Field>
              <Button
                variant="neutral"
                size="icon"
                disabled={titles.length === 1}
                aria-label={`Remove target title ${index + 1}`}
                onClick={() => setTitles(titles.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </FieldGroup>
          ))}
          <Button
            variant="neutral"
            className="self-start"
            disabled={titles.length >= 10}
            onClick={() => setTitles([...titles, ""])}
          >
            <Plus /> Add another role
          </Button>
        </FieldGroup>
        <Accordion type="single" collapsible>
          <AccordionItem value="preferences">
            <AccordionTrigger>More preferences · optional</AccordionTrigger>
            <AccordionContent>
              <FieldGroup className="gap-5 pt-3">
                <CardDescription>
                  These apply to all the roles above. Leave anything open if you
                  are flexible.
                </CardDescription>
                <Field>
                  <FieldLabel htmlFor="target-locations">Locations</FieldLabel>
                  <Input
                    id="target-locations"
                    placeholder="e.g. Chicago, Austin"
                    value={location}
                    maxLength={500}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                  <CardDescription className="text-xs">
                    Separate multiple cities or regions with commas.
                  </CardDescription>
                </Field>
                <Field>
                  <FieldLabel id="remote-label">Work arrangement</FieldLabel>
                  <RadioGroup
                    aria-labelledby="remote-label"
                    value={remote}
                    onValueChange={(value) => setRemote(String(value))}
                    className="flex flex-wrap gap-4"
                  >
                    {[
                      ["any", "Flexible"],
                      ["remote", "Prefer remote"],
                      ["onsite", "Prefer on-site / hybrid"],
                    ].map(([value, label]) => (
                      <Field
                        key={value}
                        orientation="horizontal"
                        className="w-auto"
                      >
                        <RadioGroupItem value={value} id={`remote-${value}`} />
                        <FieldLabel
                          htmlFor={`remote-${value}`}
                          className="font-normal"
                        >
                          {label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </RadioGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="target-compensation">
                    Minimum annual salary · USD
                  </FieldLabel>
                  <Input
                    id="target-compensation"
                    type="number"
                    min={0}
                    max={10000000}
                    step={1}
                    inputMode="numeric"
                    placeholder="e.g. 90000"
                    value={compensation}
                    onChange={(event) => setCompensation(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="target-keywords">
                    Useful skills or keywords
                  </FieldLabel>
                  <Textarea
                    id="target-keywords"
                    rows={2}
                    placeholder="e.g. TypeScript, accessibility, SaaS"
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                  />
                  <CardDescription className="text-xs">
                    Separate up to 30 keywords with commas.
                  </CardDescription>
                </Field>
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Unable to save preferences</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            {conflict && (
              <Button
                className="mt-3"
                variant="neutral"
                onClick={() => window.location.reload()}
              >
                Discard local changes & reload
              </Button>
            )}
          </Alert>
        )}
        <CardDescription role="status" aria-live="polite">
          {busy ? "Saving your preferences…" : notice}
        </CardDescription>
        <FieldGroup className="flex-row flex-wrap gap-3">
          <Button onClick={() => save(true)} disabled={busy || conflict}>
            Find jobs for me <ArrowRight />
          </Button>
          <Button
            variant="neutral"
            onClick={() => save(false)}
            disabled={busy || conflict}
          >
            Save preferences
          </Button>
          <Button variant="neutral" onClick={onReview} disabled={busy}>
            Back to resume
          </Button>
        </FieldGroup>
      </FieldGroup>
    </FieldSet>
  )
}
