"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { targetSchema } from "@/lib/domain/onboarding/schema"
import type { DiscoveryData } from "@/lib/domain/discovery/service"
import type { SettingsOperation } from "./settings-profile"
import { settingsRequest } from "./settings-request"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { Field, FieldGroup, FieldLabel } from "./field"
import { Button } from "./button"
import { LinkButton } from "./link-button"
import { Input } from "./input"
import { Textarea } from "./textarea"
import { RadioGroup, RadioGroupItem } from "./radio-group"
export function SettingsTargets({
  discover,
  busy,
  run,
}: {
  discover: DiscoveryData | null
  busy: boolean
  run: SettingsOperation
}) {
  const router = useRouter()
  const [titles, setTitles] = useState(
    discover?.targets.map((t) => t.targetTitle).join("\n") ?? ""
  )
  const [location, setLocation] = useState(discover?.targets[0]?.location ?? "")
  const [keywords, setKeywords] = useState(
    discover?.targets[0]?.keywords.join(", ") ?? ""
  )
  const [remote, setRemote] = useState(
    discover?.targets[0]?.remotePreferred === true
      ? "remote"
      : discover?.targets[0]?.remotePreferred === false
        ? "onsite"
        : "any"
  )
  const [salary, setSalary] = useState(
    discover?.targets[0]?.minimumCompensationUsd?.toString() ?? ""
  )
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your search direction</CardTitle>
          <CardDescription>
            Matching uses your confirmed resume and these preferences. New
            results appear after the next background scan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!discover?.ready ? (
            <LinkButton href="/onboarding">Finish account setup</LinkButton>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const targets = titles
                    .split("\n")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((targetTitle) => ({
                      targetTitle,
                      location: location.trim() || null,
                      remotePreferred:
                        remote === "remote"
                          ? true
                          : remote === "onsite"
                            ? false
                            : null,
                      minimumCompensationUsd: salary ? Number(salary) : null,
                      keywords: keywords
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    }))
                  const parsed = z
                    .array(targetSchema)
                    .min(1)
                    .max(10)
                    .safeParse(targets)
                  if (!parsed.success)
                    throw new Error(
                      "Use 1–10 distinct roles (up to 120 characters each), up to 30 keywords (100 characters each), and a whole-number salary between 0 and 10,000,000."
                    )
                  if (
                    new Set(targets.map((t) => t.targetTitle.toLowerCase()))
                      .size !== targets.length
                  )
                    throw new Error("Choose distinct target roles.")
                  await settingsRequest("/api/discovery", "POST", {
                    action: "preferences",
                    expectedRevision: discover.preferenceRevision,
                    targets: parsed.data,
                  })
                  router.refresh()
                }, "Preferences saved.")
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="target-titles">
                    Target titles · one per line
                  </FieldLabel>
                  <Textarea
                    id="target-titles"
                    value={titles}
                    onChange={(e) => setTitles(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="target-locations">Locations</FieldLabel>
                  <Input
                    id="target-locations"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="target-keywords">
                    Skills or keywords · comma separated
                  </FieldLabel>
                  <Input
                    id="target-keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="target-salary">
                    Minimum annual salary · USD
                  </FieldLabel>
                  <Input
                    id="target-salary"
                    type="number"
                    min="0"
                    max="10000000"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>Work arrangement</FieldLabel>
                  <RadioGroup
                    value={remote}
                    onValueChange={(value) => {
                      if (typeof value === "string") setRemote(value)
                    }}
                    aria-label="Work arrangement"
                    className="gap-3"
                  >
                    {[
                      ["any", "Any arrangement"],
                      ["remote", "Prefer remote"],
                      ["onsite", "Prefer on-site"],
                    ].map(([value, label]) => (
                      <Field key={value} orientation="horizontal">
                        <RadioGroupItem
                          value={value}
                          id={`settings-${value}`}
                        />
                        <FieldLabel htmlFor={`settings-${value}`}>
                          {label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </RadioGroup>
                </Field>
                <Button type="submit" disabled={busy} className="w-fit">
                  {busy ? "Saving…" : "Save preferences"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </>
  )
}
