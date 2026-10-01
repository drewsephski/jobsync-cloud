"use client"
import { useState } from "react"
import Link from "next/link"
import {
  Plus,
  Search,
  ArrowUpRight,
  RefreshCw,
  Briefcase,
  Clock,
} from "lucide-react"
import type { ApplicationsData } from "@/lib/domain/applications/service"
import {
  statusLabels,
  statuses,
  activeStatuses,
  type ApplicationDetails,
  type ApplicationStatus,
} from "@/lib/domain/applications/schema"
import { applicationRequest, loadApplications } from "./application-api"
import { ApplicationFields, StatusSelect } from "./application-fields"
import { ApplicationDetail } from "./application-detail"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
const blank: ApplicationDetails = {
  company: "",
  title: "",
  location: "",
  postingUrl: null,
  salary: null,
  notes: null,
  appliedOn: null,
  followUpOn: null,
  nextAction: null,
  resumeVersionId: null,
}
export function ApplicationTracker({
  initial,
  initialId,
}: {
  initial: ApplicationsData
  initialId?: string
}) {
  const [data, setData] = useState(initial)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("active")
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const selected = data.applications.find((a) => a.id === selectedId)
  async function refresh() {
    try {
      setData(await loadApplications())
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh.")
      throw e
    }
  }
  const applications = data.applications.filter((a) => {
    const matchesStatus =
      filter === "archived"
        ? !!a.archivedAt
        : !a.archivedAt &&
          (filter === "all" ||
            (filter === "active" && activeStatuses.includes(a.status)) ||
            a.status === filter)
    const search = query.trim().toLowerCase()
    return (
      matchesStatus &&
      (!search ||
        `${a.company} ${a.title} ${a.stageName ?? ""}`
          .toLowerCase()
          .includes(search))
    )
  })
  const active = data.applications.filter(
    (a) => !a.archivedAt && activeStatuses.includes(a.status)
  )
  const options = [
    { value: "active", label: `Active · ${active.length}` },
    { value: "all", label: "All applications" },
    ...statuses.map((s) => ({ value: s, label: statusLabels[s] })),
    { value: "archived", label: "Archived" },
  ]
  return (
    <FieldGroup className="onboarding-surface discovery-surface mx-auto max-w-6xl gap-7 py-6 sm:px-4">
      <FieldGroup className="flex-row flex-wrap items-start justify-between gap-4">
        <FieldGroup className="min-w-0 flex-1 basis-full gap-2 sm:basis-0">
          <CardDescription className="text-xs tracking-widest uppercase">
            Your search, moving forward
          </CardDescription>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-3xl sm:text-4xl"
          >
            Applications
          </CardTitle>
          <CardDescription>
            Keep every opportunity and your next step in one place.
          </CardDescription>
        </FieldGroup>
        <FieldGroup className="[container-type:normal] w-auto flex-row flex-wrap gap-2">
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Overview
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add application
          </Button>
        </FieldGroup>
      </FieldGroup>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="grid gap-3 sm:grid-cols-3">
        {[
          ["Active applications", active.length],
          [
            "In interviews",
            active.filter((a) => a.status === "interview").length,
          ],
          [
            "Follow-ups due",
            active.filter((a) => a.followUpOn && a.followUpOn <= data.today)
              .length,
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <CardDescription className="text-xs">{label}</CardDescription>
              <CardTitle className="mt-2 text-2xl">{value}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </FieldGroup>
      <FieldGroup className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
        <Field>
          <FieldLabel htmlFor="application-search">
            Search applications
          </FieldLabel>
          <Input
            id="application-search"
            placeholder="Company, title or stage…"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="application-filter">Show</FieldLabel>
          <Select
            value={filter}
            items={options}
            onValueChange={(v) => setFilter(v ?? "active")}
          >
            <SelectTrigger id="application-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="onboarding-surface">
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          variant="neutral"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await refresh()
            } catch {
            } finally {
              setBusy(false)
            }
          }}
        >
          <RefreshCw /> Refresh
        </Button>
      </FieldGroup>
      <FieldGroup className="gap-3">
        {applications.length ? (
          applications.map((a) => (
            <Card key={a.id} className="gap-3">
              <CardHeader className="gap-2">
                <FieldGroup className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardDescription className="font-medium">
                    {a.company}
                  </CardDescription>
                  <Badge variant="neutral">
                    {a.archivedAt ? "Archived" : statusLabels[a.status]}
                  </Badge>
                </FieldGroup>
                <CardTitle
                  role="heading"
                  aria-level={2}
                  className="text-lg leading-snug"
                >
                  <Button
                    variant="neutral"
                    className="h-auto max-w-full justify-start border-0! p-0 text-left whitespace-normal"
                    onClick={() => setSelectedId(a.id)}
                    aria-label={`Open ${a.title} at ${a.company}`}
                  >
                    {a.title}
                  </Button>
                </CardTitle>
                <CardDescription className="text-sm">
                  {a.location || "Location not listed"}
                  {a.stageName ? ` · ${a.stageName}` : ""}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex-wrap justify-between gap-3 border-t border-border pt-3">
                <CardDescription
                  className={`flex min-w-0 items-center gap-2 text-xs ${a.followUpOn && a.followUpOn <= data.today && !a.archivedAt ? "text-foreground" : ""}`}
                >
                  <Clock className="size-3.5 shrink-0" />
                  {a.followUpOn && !a.archivedAt
                    ? `${a.followUpOn < data.today ? "Overdue" : a.followUpOn === data.today ? "Due today" : "Follow up"} · ${a.followUpOn}${a.nextAction ? ` · ${a.nextAction}` : ""}`
                    : a.nextAction ||
                      (a.appliedOn
                        ? `Applied ${a.appliedOn}`
                        : "Choose your next step")}
                </CardDescription>
                <Button
                  size="sm"
                  variant="neutral"
                  onClick={() => setSelectedId(a.id)}
                >
                  View application <ArrowUpRight />
                </Button>
              </CardFooter>
            </Card>
          ))
        ) : (
          <Empty className="min-h-72 border-border bg-secondary-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {query ? <Search /> : <Briefcase />}
              </EmptyMedia>
              <EmptyTitle>
                {query || filter !== "active"
                  ? "No applications match this view"
                  : "Start with an opportunity"}
              </EmptyTitle>
              <EmptyDescription>
                {query
                  ? "Try a different company or title."
                  : "Track an opening from Discover or add a job you found elsewhere. Both live here."}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              nativeButton={false}
              render={<Link href="/dashboard/discover" />}
            >
              Discover jobs
            </Button>
          </Empty>
        )}
      </FieldGroup>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent className="onboarding-surface discovery-surface max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-6 text-xl leading-snug">
              {selected?.title}
            </DialogTitle>
            <DialogDescription>{selected?.company}</DialogDescription>
          </DialogHeader>
          {selected && (
            <ApplicationDetail
              key={`${selected.id}:${selected.revision}`}
              application={selected}
              resumes={data.resumes}
              today={data.today}
              refresh={refresh}
              close={() => setSelectedId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="onboarding-surface max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add an application</DialogTitle>
            <DialogDescription>
              A job you found anywhere. Start with the essentials.
            </DialogDescription>
          </DialogHeader>
          {creating && (
            <CreateApplication
              data={data}
              done={async (id) => {
                setCreating(false)
                await refresh()
                setSelectedId(id)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </FieldGroup>
  )
}
function CreateApplication({
  data,
  done,
}: {
  data: ApplicationsData
  done: (id: string) => Promise<void>
}) {
  const [details, setDetails] = useState(blank)
  const [status, setStatus] = useState<ApplicationStatus>("saved")
  const [creationKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError("")
        try {
          const result = await applicationRequest({
            action: "create",
            creationKey,
            details,
            status,
            stageName: null,
          })
          await done(result.applicationId)
        } catch (e) {
          setError(e instanceof Error ? e.message : "Please try again.")
        } finally {
          setBusy(false)
        }
      }}
    >
      <FieldGroup className="gap-5">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <StatusSelect
          value={status}
          onChange={(value) => {
            setStatus(value)
            if (value === "applied" && !details.appliedOn)
              setDetails({ ...details, appliedOn: data.today })
          }}
        />
        <ApplicationFields
          details={details}
          onChange={setDetails}
          resumes={data.resumes}
          today={data.today}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add application"}
        </Button>
      </FieldGroup>
    </form>
  )
}
