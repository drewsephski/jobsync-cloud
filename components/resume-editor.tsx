"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, FileText } from "@/components/ui/animated-icons"
import type { OnboardingState } from "@/lib/domain/onboarding/service"
import {
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/domain/onboarding/schema"
import { resumeSchema } from "@/lib/ai/resume-schema"
import {
  onboardingError,
  onboardingRequest,
  OnboardingRequestError,
} from "./onboarding-api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ResumeTextField, ResumeEntries } from "./resume-fields"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

function cleanContent(data: ResumeContent): ResumeContent {
  function clean(value: unknown): unknown {
    if (typeof value === "string") return value.trim() || null
    if (Array.isArray(value))
      return value.map(clean).filter((item) => item !== null)
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, clean(item)])
      )
    return value
  }
  return resumeContentSchema.parse(clean(data))
}

export function ResumeEditor({
  initialState,
  onConfirmed,
}: {
  initialState: OnboardingState
  onConfirmed?: (state: OnboardingState) => void
}) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [data, setData] = useState(initialState.version!.data)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [tab, setTab] = useState("overview")
  const dirty = JSON.stringify(data) !== JSON.stringify(state.version!.data)
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])
  const original = resumeSchema.parse(state.original!.data)
  const missing = [
    !data.contact.name && "Name",
    !data.contact.email && "Email",
    !data.summary && "Summary",
    !data.skills.length && "Skills",
    !data.employment.length && "Employment",
  ].filter(Boolean)
  async function mutate(action: "save" | "confirm") {
    setBusy(true)
    setError(null)
    setNotice("")
    try {
      const next = await onboardingRequest(action, {
        expectedVersionId: state.version!.id,
        ...(action === "save" ? { data: cleanContent(data) } : {}),
      })
      setState(next)
      setData(next.version!.data)
      setConflict(false)
      setAcknowledged(false)
      if (action === "confirm") {
        setNotice(
          "Resume confirmed. This exact version is now your accepted resume."
        )
        if (onConfirmed) onConfirmed(next)
        else router.refresh()
      } else
        setNotice(
          `Saved as version ${next.version!.version}. Review and confirm when ready.`
        )
    } catch (caught) {
      setConflict(
        caught instanceof OnboardingRequestError && caught.status === 409
      )
      setError(
        caught instanceof Error && caught.name === "ZodError"
          ? "Some fields are too long. Shorten them before saving."
          : onboardingError(caught)
      )
    } finally {
      setBusy(false)
    }
  }
  async function reload() {
    setBusy(true)
    try {
      const next = await onboardingRequest()
      // Explicit reload is the only action that discards unsaved local changes.
      if (!next.version) {
        router.refresh()
        return
      }
      setState(next)
      setData(next.version.data)
      setError(null)
      setConflict(false)
      setAcknowledged(false)
      setNotice("Latest saved version loaded.")
    } catch (caught) {
      setError(onboardingError(caught))
    } finally {
      setBusy(false)
    }
  }
  async function openOriginal() {
    setBusy(true)
    setError(null)
    try {
      const result = await fetch(
        `/api/resume-uploads/${state.upload!.id}/download-url`,
        { method: "POST", signal: AbortSignal.timeout(10_000) }
      )
      if (!result.ok) throw new Error("download_unavailable")
      const { url } = await result.json()
      const link = document.createElement("a")
      link.href = url
      link.download = state.upload!.fileName
      link.click()
    } catch {
      setError(
        "The original file is temporarily unavailable. Try downloading it again."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldSet disabled={busy}>
      <FieldGroup className="gap-6">
        <FieldGroup className="flex-row flex-wrap items-center justify-between gap-3">
          <Badge variant="neutral">
            {state.version!.confirmed ? <Check /> : <FileText />}
            {state.version!.confirmed
              ? "User confirmed"
              : "Draft · confirmation required"}{" "}
            · v{state.version!.version}
          </Badge>
          <Button
            variant="neutral"
            size="sm"
            disabled={busy}
            onClick={openOriginal}
          >
            Download original file
          </Button>
        </FieldGroup>
        <Alert className="review-guidance">
          <AlertTitle>Make this resume yours</AlertTitle>
          <AlertDescription>
            Check every section against your original file. AI can miss details
            or put them in the wrong place. Blank fields mean “not found”; add
            what applies and remove anything incorrect.
          </AlertDescription>
        </Alert>
        {missing.length > 0 && (
          <CardDescription className="text-amber-800 dark:text-amber-300">
            Check missing sections: {missing.join(", ")}. Only your name and
            some resume content are required; other sections can stay empty.
          </CardDescription>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList
            className="w-full justify-start"
            aria-label="Resume sections"
          >
            <TabsTrigger value="overview">Contact & overview</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="education">Education</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-6">
            <FieldGroup className="gap-7">
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["name", "Full name"],
                    ["email", "Email"],
                    ["phone", "Phone"],
                    ["location", "Location"],
                  ] as const
                ).map(([key, label]) => (
                  <ResumeTextField
                    key={key}
                    id={`contact-${key}`}
                    label={label}
                    value={data.contact[key]}
                    onChange={(value) =>
                      setData({
                        ...data,
                        contact: { ...data.contact, [key]: value || null },
                      })
                    }
                  />
                ))}
              </FieldGroup>
              <ResumeTextField
                id="contact-links"
                label="Links · one per line"
                value={data.contact.links.join("\n")}
                multiline
                onChange={(value) =>
                  setData({
                    ...data,
                    contact: { ...data.contact, links: value.split("\n") },
                  })
                }
              />
              <ResumeTextField
                id="resume-summary"
                label="Summary"
                value={data.summary}
                multiline
                onChange={(value) =>
                  setData({ ...data, summary: value || null })
                }
              />
              <ResumeTextField
                id="resume-skills"
                label="Skills · one per line"
                value={data.skills.join("\n")}
                multiline
                onChange={(value) =>
                  setData({ ...data, skills: value.split("\n") })
                }
              />
            </FieldGroup>
          </TabsContent>
          <TabsContent value="employment" className="pt-6">
            <ResumeEntries
              kind="employment"
              title="Employment"
              values={data.employment}
              fields={[
                ["employer", "Employer"],
                ["title", "Job title"],
                ["location", "Location"],
                ["startDate", "Start date · as written"],
                ["endDate", "End date · leave blank if unknown"],
                ["highlights", "Highlights · one per line"],
              ]}
              onChange={(entries) =>
                setData({
                  ...data,
                  employment: entries as ResumeContent["employment"],
                })
              }
            />
          </TabsContent>
          <TabsContent value="education" className="pt-6">
            <ResumeEntries
              kind="education"
              title="Education"
              values={data.education}
              fields={[
                ["institution", "Institution"],
                ["qualification", "Qualification"],
                ["field", "Field of study"],
                ["startDate", "Start date · as written"],
                ["endDate", "End date · as written"],
              ]}
              onChange={(entries) =>
                setData({
                  ...data,
                  education: entries as ResumeContent["education"],
                })
              }
            />
          </TabsContent>
          <TabsContent value="credentials" className="pt-6">
            <ResumeEntries
              kind="credentials"
              title="Credential"
              values={data.credentials}
              fields={[
                ["name", "Credential or certification"],
                ["issuer", "Issuer"],
                ["date", "Date · as written"],
              ]}
              onChange={(entries) =>
                setData({
                  ...data,
                  credentials: entries as ResumeContent["credentials"],
                })
              }
            />
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="closed">
          <TabsList
            variant="line"
            aria-label="Resume reference"
            className="flex h-auto w-full flex-wrap justify-start"
          >
            <TabsTrigger value="closed">Hide reference</TabsTrigger>
            <TabsTrigger value="source">Original AI draft</TabsTrigger>
            <TabsTrigger value="history">Version history</TabsTrigger>
          </TabsList>
          <TabsContent value="source">
            <Card className="review-entry" size="sm">
              <CardHeader>
                <CardTitle>Original extraction · unchanged</CardTitle>
                <CardDescription>
                  This is the AI draft, not your accepted resume. Compare its
                  text with the original document.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="whitespace-pre-wrap">
                  {[
                    original.contact.name,
                    original.contact.email,
                    original.contact.phone,
                    original.contact.location,
                    ...original.contact.links,
                    original.summary,
                    original.skills.join(" · "),
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </CardDescription>
                {[
                  ...original.employment,
                  ...original.education,
                  ...original.credentials,
                ].map((entry, index) => (
                  <CardDescription
                    key={index}
                    className="border-l-2 border-border pl-4 whitespace-pre-wrap"
                  >
                    {entry.evidence}
                  </CardDescription>
                ))}
                <CardDescription className="font-mono text-xs break-all text-foreground">
                  Source SHA-256: {state.original!.sha256}
                  <br />
                  {state.original!.extractionVersion} ·{" "}
                  {state.original!.promptVersion} ·{" "}
                  {state.original!.schemaVersion}
                </CardDescription>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="history">
            <FieldGroup className="gap-3 py-4">
              {state.history.map((version) => (
                <CardDescription key={version.id}>
                  Version {version.version} ·{" "}
                  {version.source === "upload"
                    ? "AI-generated draft"
                    : "Your saved edits"}
                  {version.confirmed ? " · User confirmed" : ""} ·{" "}
                  {new Date(version.createdAt).toLocaleString()}
                </CardDescription>
              ))}
            </FieldGroup>
          </TabsContent>
        </Tabs>
        <FieldGroup className="review-actions gap-4 border-t border-border pt-5">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>
                {conflict ? "Newer changes are saved" : "Unable to continue"}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              {conflict && (
                <Button
                  variant="neutral"
                  className="mt-3"
                  disabled={busy}
                  onClick={reload}
                >
                  Discard local edits & load latest
                </Button>
              )}
            </Alert>
          )}
          <CardDescription role="status" aria-live="polite">
            {busy
              ? "Saving securely…"
              : notice ||
                (dirty ? "You have unsaved changes." : "All changes saved.")}
          </CardDescription>
          {!state.version!.confirmed && (
            <Field orientation="horizontal">
              <Checkbox
                id="review-acknowledge"
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked)}
                disabled={busy || dirty || conflict}
              />
              <FieldLabel htmlFor="review-acknowledge" className="font-normal">
                I reviewed all sections and corrected any missing or inaccurate
                information.
              </FieldLabel>
            </Field>
          )}
          <FieldGroup className="flex-row flex-wrap gap-3">
            <Button
              variant="neutral"
              disabled={busy || !dirty || conflict}
              onClick={() => mutate("save")}
            >
              Save changes
            </Button>
            <Button
              disabled={
                busy ||
                dirty ||
                conflict ||
                (state.version!.confirmed ? !onConfirmed : !acknowledged)
              }
              onClick={() =>
                state.version!.confirmed && onConfirmed
                  ? onConfirmed(state)
                  : mutate("confirm")
              }
            >
              {state.version!.confirmed
                ? onConfirmed
                  ? "Find jobs for me"
                  : "Resume confirmed"
                : "Confirm resume"}
              <Check />
            </Button>
          </FieldGroup>
          <CardDescription className="text-xs text-foreground">
            Saving keeps an editable draft. Confirm resume accepts only the
            exact saved version you reviewed.
          </CardDescription>
        </FieldGroup>
      </FieldGroup>
    </FieldSet>
  )
}
