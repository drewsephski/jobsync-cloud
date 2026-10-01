"use client"
import { useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Archive,
  RotateCcw,
  Pencil,
  ArrowRight,
  Clock,
} from "@/components/ui/animated-icons"
import type {
  ApplicationView,
  ApplicationsData,
} from "@/lib/domain/applications/service"
import {
  statusLabels,
  type ApplicationDetails,
} from "@/lib/domain/applications/schema"
import { applicationRequest, ApplicationApiError } from "./application-api"
import { ApplicationFields, StatusSelect } from "./application-fields"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item"
export function ApplicationDetail({
  application: a,
  resumes,
  today,
  refresh,
  close,
}: {
  application: ApplicationView
  resumes: ApplicationsData["resumes"]
  today: string
  refresh: () => Promise<void>
  close: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [movement, setMovement] = useState(false)
  const [details, setDetails] = useState<ApplicationDetails>({
    company: a.company,
    title: a.title,
    location: a.location,
    postingUrl: a.postingUrl,
    salary: a.salary,
    notes: a.notes,
    appliedOn: a.appliedOn,
    followUpOn: a.followUpOn,
    nextAction: a.nextAction,
    resumeVersionId: a.resumeVersionId,
  })
  const [status, setStatus] = useState(a.status)
  const [stageName, setStageName] = useState(a.stageName ?? "")
  const [occurredOn, setOccurredOn] = useState(today)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null)
  async function mutate(input: Record<string, unknown>) {
    setBusy(true)
    setError("")
    try {
      await applicationRequest({
        ...input,
        applicationId: a.id,
        expectedRevision: a.revision,
      })
      if (input.action === "delete") close()
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.")
      setConflict(
        e instanceof ApplicationApiError && e.code === "application_conflict"
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  const source = a.sourceSnapshot as {
    kind?: string
    posting?: { description?: string; contentHash?: string }
    match?: {
      reasons?: string[]
      relevance?: number
      aiScore?: number | null
      rationale?: string | null
      stalePosting?: boolean
    }
  }
  const resume = a.resumeSnapshot as { title?: string; version?: number } | null
  const resumeOptions =
    a.resumeVersionId && !resumes.some((r) => r.id === a.resumeVersionId)
      ? [
          ...resumes,
          {
            id: a.resumeVersionId,
            label: `${resume?.title ?? "Recorded resume"} · v${resume?.version ?? "?"} (previously confirmed)`,
          },
        ]
      : resumes
  return (
    <FieldGroup className="gap-6">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
          {conflict && (
            <Button
              variant="neutral"
              className="mt-3"
              disabled={busy}
              onClick={refresh}
            >
              Discard local edits & load latest
            </Button>
          )}
        </Alert>
      )}
      <FieldGroup className="flex-row flex-wrap items-center gap-2">
        <Badge variant="neutral">{statusLabels[a.status]}</Badge>
        {a.stageName && <Badge variant="neutral">{a.stageName}</Badge>}
        {a.archivedAt && <Badge variant="neutral">Archived</Badge>}
        <CardDescription className="text-xs">
          {source.kind === "discover" ? "From Discover" : "Added manually"}
        </CardDescription>
      </FieldGroup>
      {a.followUpOn && !a.archivedAt && (
        <Alert className="review-guidance">
          <Clock />
          <AlertDescription>
            {a.followUpOn < today
              ? "Overdue"
              : a.followUpOn === today
                ? "Due today"
                : "Follow up"}{" "}
            · {a.followUpOn}
            {a.nextAction ? ` · ${a.nextAction}` : ""}
          </AlertDescription>
        </Alert>
      )}
      {!editing && (
        <FieldGroup className="gap-3">
          <CardDescription>
            {a.location || "Location not listed"}
            {a.salary ? ` · ${a.salary}` : ""}
          </CardDescription>
          <CardDescription>
            {a.appliedOn
              ? `Applied ${a.appliedOn}`
              : "Application date not recorded"}
            {resume ? ` · ${resume.title} v${resume.version}` : ""}
          </CardDescription>
          {a.nextAction && !a.followUpOn && (
            <CardDescription className="font-medium">
              Next: {a.nextAction}
            </CardDescription>
          )}
          {a.notes && (
            <CardDescription className="break-words whitespace-pre-wrap">
              {a.notes}
            </CardDescription>
          )}
          <FieldGroup className="flex-row flex-wrap gap-2">
            {!a.archivedAt && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setMovement(!movement)
                    setEditing(false)
                  }}
                >
                  <ArrowRight /> Record movement
                </Button>
                <Button
                  variant="neutral"
                  disabled={busy}
                  onClick={() => {
                    setEditing(true)
                    setMovement(false)
                  }}
                >
                  <Pencil /> Edit details
                </Button>
              </>
            )}
            {a.postingUrl && (
              <Button
                variant="neutral"
                nativeButton={false}
                render={
                  <Link
                    href={a.postingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ArrowUpRight /> Original posting
              </Button>
            )}
          </FieldGroup>
          {source.kind === "discover" && (
            <CardDescription className="text-xs">
              {!a.posting
                ? "The public listing is no longer available. Your application and captured details are preserved."
                : !a.posting.open
                  ? "The public listing has closed. Your application is still tracked."
                  : source.posting?.contentHash !== a.posting.contentHash
                    ? "The public listing has changed. Your captured details are preserved."
                    : "Posting details were captured when you started tracking."}
            </CardDescription>
          )}
        </FieldGroup>
      )}
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (await mutate({ action: "edit", details })) setEditing(false)
          }}
        >
          <FieldGroup className="gap-5">
            <ApplicationFields
              details={details}
              onChange={setDetails}
              resumes={resumeOptions}
              today={today}
            />
            <FieldGroup className="flex-row gap-2">
              <Button type="submit" disabled={busy || conflict}>
                Save details
              </Button>
              <Button
                variant="neutral"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </FieldGroup>
          </FieldGroup>
        </form>
      )}
      {movement && (
        <Card className="review-entry">
          <CardHeader>
            <CardTitle className="text-base">Record movement</CardTitle>
            <CardDescription>
              Each update stays in your history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (
                  await mutate({
                    action: "transition",
                    status,
                    stageName: stageName || null,
                    occurredOn,
                    note: note || null,
                  })
                )
                  setMovement(false)
              }}
            >
              <FieldGroup className="gap-4">
                <StatusSelect value={status} onChange={setStatus} />
                <Field>
                  <FieldLabel htmlFor="movement-stage">
                    Stage name · optional
                  </FieldLabel>
                  <Input
                    id="movement-stage"
                    value={stageName}
                    maxLength={120}
                    placeholder="e.g. Technical interview"
                    onChange={(e) => setStageName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="movement-date">Movement date</FieldLabel>
                  <Input
                    id="movement-date"
                    type="date"
                    required
                    max={today}
                    value={occurredOn}
                    onChange={(e) => setOccurredOn(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="movement-note">
                    Movement note · optional
                  </FieldLabel>
                  <Textarea
                    id="movement-note"
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <FieldGroup className="flex-row gap-2">
                  <Button type="submit" disabled={busy || conflict}>
                    Save movement
                  </Button>
                  <Button
                    variant="neutral"
                    disabled={busy}
                    onClick={() => setMovement(false)}
                  >
                    Cancel
                  </Button>
                </FieldGroup>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      )}
      <FieldGroup className="gap-3">
        <CardTitle role="heading" aria-level={3} className="text-base">
          Application history
        </CardTitle>
        <CardDescription className="text-xs">
          Latest recorded updates first. Movement dates can reflect earlier
          activity.
        </CardDescription>
        <ItemGroup className="gap-0" aria-label="Application history">
          {a.events.map((event) => (
            <Item
              key={event.id}
              className="rounded-none border-0 border-l-2 border-border py-3 pl-5"
            >
              <ItemContent>
                <ItemTitle className="text-sm">
                  {event.kind === "created"
                    ? `Started tracking · ${statusLabels[event.toStatus]}`
                    : event.kind === "archived"
                      ? "Archived"
                      : event.kind === "restored"
                        ? "Restored"
                        : event.fromStatus !== event.toStatus
                          ? `${statusLabels[event.fromStatus!]} → ${statusLabels[event.toStatus]}`
                          : statusLabels[event.toStatus]}
                  {event.stageName ? ` · ${event.stageName}` : ""}
                </ItemTitle>
                <ItemDescription className="line-clamp-none text-xs">
                  {event.occurredOn}
                  {event.note ? ` · ${event.note}` : ""}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </FieldGroup>
      {source.match && (
        <Card className="review-entry">
          <CardHeader>
            <CardTitle role="heading" aria-level={3} className="text-sm">
              Why Discover surfaced this job
            </CardTitle>
            <CardDescription>
              {source.match.reasons?.join(". ")}
            </CardDescription>
            <CardDescription className="text-xs">
              Captured match context. It reflects the resume and posting used at
              that time, not your current fit.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {!editing && !movement && (
        <FieldGroup className="gap-3 border-t border-border pt-4">
          {confirm ? (
            <Alert>
              <AlertDescription>
                {confirm === "archive"
                  ? "Archive this application? It will leave your active list and remain available in Archived."
                  : "Permanently delete this application and its history? This cannot be undone."}
              </AlertDescription>
              <FieldGroup className="mt-3 flex-row flex-wrap gap-2">
                <Button
                  disabled={busy || conflict}
                  onClick={async () => {
                    if (
                      await mutate(
                        confirm === "delete"
                          ? { action: "delete" }
                          : { action: "archive", archived: true }
                      )
                    )
                      setConfirm(null)
                  }}
                >
                  {confirm === "delete"
                    ? "Delete permanently"
                    : "Confirm archive"}
                </Button>
                <Button
                  variant="neutral"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </Button>
              </FieldGroup>
            </Alert>
          ) : (
            <FieldGroup className="flex-row flex-wrap justify-between gap-3">
              <Button
                variant="neutral"
                size="sm"
                disabled={busy || conflict}
                onClick={() =>
                  a.archivedAt
                    ? mutate({ action: "archive", archived: false })
                    : setConfirm("archive")
                }
              >
                {a.archivedAt ? <RotateCcw /> : <Archive />}
                {a.archivedAt ? "Restore application" : "Archive application"}
              </Button>
              {a.archivedAt && (
                <Button
                  variant="neutral"
                  size="sm"
                  disabled={busy || conflict}
                  onClick={() => setConfirm("delete")}
                >
                  Delete application
                </Button>
              )}
            </FieldGroup>
          )}
        </FieldGroup>
      )}
    </FieldGroup>
  )
}
