"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Building2,
  Search,
  Bookmark,
  ArrowUpRight,
  Check,
  RefreshCw,
  X,
  SlidersHorizontal,
  Plus,
} from "lucide-react"
import type { DiscoveryData } from "@/lib/domain/discovery/service"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  ItemGroup,
} from "@/components/ui/item"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
const providerNames = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
}
async function request(
  query: string,
  filter: string,
  signal?: AbortSignal
): Promise<DiscoveryData> {
  const response = await fetch(
    `/api/discovery?q=${encodeURIComponent(query)}&state=${filter}`,
    { signal: signal ?? AbortSignal.timeout(10_000), cache: "no-store" }
  )
  if (!response.ok)
    throw new Error("Could not refresh discovery. Please try again.")
  return response.json()
}
function age(value: string) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  )
  return days === 0 ? "today" : `${days}d ago`
}
export function DiscoverFeed({ initial }: { initial: DiscoveryData }) {
  const [data, setData] = useState(initial)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("new")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [preferences, setPreferences] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      request(
        query,
        filter,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      )
        .then(setData)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, filter])
  async function track(postingId: string, matchId: string) {
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "track", postingId, matchId }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok)
        throw new Error("Could not track this application. Please try again.")
      setData(await request(query, filter))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.")
    } finally {
      setBusy(false)
    }
  }
  async function mutate(input: unknown) {
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(
          result.error === "preferences_conflict"
            ? "Your preferences changed in another tab. Refresh and try again."
            : result.error === "subscription_required"
              ? "Your trial or subscription ended. Open Account & billing to continue."
              : result.error === "email_verification_required"
                ? "Verify your email in Account & billing to start your trial."
                : result.error === "watch_limit"
                  ? "You can monitor up to 30 company boards. Remove one to add another."
                  : "Could not save your change. Please try again."
        )
      }
      setData(await request(query, filter))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.")
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldGroup className="onboarding-surface discovery-surface mx-auto max-w-6xl gap-7 px-4 py-10 sm:px-8">
      <FieldGroup className="flex-row flex-wrap items-start justify-between gap-4">
        <FieldGroup className="min-w-0 flex-1 basis-full gap-2 sm:basis-0">
          <CardDescription className="text-xs tracking-widest uppercase">
            Your next opportunity
          </CardDescription>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-3xl sm:text-4xl"
          >
            Discover
          </CardTitle>
          <CardDescription>
            Choose companies you’re interested in. JobSync keeps watching their
            public openings.
          </CardDescription>
        </FieldGroup>
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/dashboard/jobs" />}
        >
          Your applications
        </Button>
      </FieldGroup>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!data.ready && (
        <Alert>
          <AlertDescription>
            Confirm your resume and save target roles to start discovering
            relevant jobs.
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <FieldGroup className="min-w-0 gap-5">
          <Item className="border-border bg-secondary-background">
            <ItemContent className="min-w-0">
              <ItemTitle>Your search direction</ItemTitle>
              <ItemDescription className="line-clamp-none">
                {data.targets.map((t) => t.targetTitle).join(" · ") ||
                  "No active target roles"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="neutral"
                onClick={() => setPreferences(true)}
              >
                <SlidersHorizontal /> Refine
              </Button>
            </ItemActions>
          </Item>
          <FieldGroup className="flex-row flex-wrap items-center justify-between gap-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
              <TabsList aria-label="Discovery results">
                <TabsTrigger value="new">New {data.counts.new}</TabsTrigger>
                <TabsTrigger value="saved">
                  Saved {data.counts.saved}
                </TabsTrigger>
                <TabsTrigger value="dismissed">
                  Dismissed {data.counts.dismissed}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant="neutral"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  setData(await request(query, filter))
                  setError("")
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <RefreshCw className={busy ? "animate-spin" : ""} /> Refresh
            </Button>
          </FieldGroup>
          {data.jobs.length === 0 ? (
            <Empty className="min-h-80 border-border bg-secondary-background">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle className="text-xl">
                  {data.watches.length === 0
                    ? "Start with a company you like"
                    : filter === "saved"
                      ? "Keep the openings worth a closer look"
                      : filter === "dismissed"
                        ? "Nothing dismissed yet"
                        : "Your search is taking shape"}
                </EmptyTitle>
                <EmptyDescription>
                  {data.watches.length === 0
                    ? "Search the company directory and choose Watch. Your first openings will appear after the next background check."
                    : filter === "new"
                      ? "We check watched boards in the background every few minutes. If no relevant openings appear, try broader target titles or locations. Public boards are refreshed every six hours."
                      : "Use the actions on a job to organize your results."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            data.jobs.map((job) => (
              <Card key={job.id} className="gap-4 overflow-hidden">
                <CardHeader className="gap-2">
                  <FieldGroup className="flex-row flex-wrap items-center justify-between gap-2">
                    <CardDescription className="font-medium text-foreground">
                      {job.company}
                    </CardDescription>
                    <Badge variant="neutral" className="text-xs">
                      {providerNames[job.provider]}
                    </Badge>
                  </FieldGroup>
                  <CardTitle
                    role="heading"
                    aria-level={2}
                    className="text-lg leading-snug"
                  >
                    {job.title}
                  </CardTitle>
                  <CardDescription>
                    {job.location || "Location not listed"}
                    {job.remote === true ? " · Remote" : ""} ·{" "}
                    {job.publishedAt
                      ? `Posted ${age(job.publishedAt)}`
                      : `First seen ${age(job.firstSeenAt)}`}
                    {!job.open ? " · Closed" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant="neutral">Matches your search</Badge>
                  <CardDescription className="text-sm leading-relaxed">
                    {job.reasons.join(". ")}.
                  </CardDescription>
                  {job.aiScore !== null && (
                    <Alert className="review-guidance">
                      <CardTitle className="text-sm">
                        AI match · {job.aiScore}/100 · {job.recommendation}
                      </CardTitle>
                      <AlertDescription className="mt-2">
                        {job.rationale}
                      </AlertDescription>
                    </Alert>
                  )}
                  {job.aiScore === null && (
                    <CardDescription className="text-xs text-foreground">
                      {job.stale
                        ? "Your resume, preferences or this posting changed. The previous AI score is hidden while relevance is recomputed."
                        : "Selected using your target titles and resume keywords. No completed AI analysis yet."}
                    </CardDescription>
                  )}
                </CardContent>
                <CardFooter className="flex-wrap justify-between gap-3 border-t border-border pt-4">
                  <Button
                    variant="neutral"
                    nativeButton={false}
                    render={
                      <Link
                        href={job.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <ArrowUpRight /> Original posting
                  </Button>
                  <FieldGroup className="[container-type:normal] w-auto flex-row flex-wrap gap-2">
                    {job.applicationId ? (
                      <Button
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/dashboard/jobs?application=${job.applicationId}`}
                          />
                        }
                      >
                        <Check />{" "}
                        {job.applicationArchived
                          ? "View archived application"
                          : "View application"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => track(job.id, job.matchId)}
                      >
                        <Plus /> Track application
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          action: "state",
                          postingId: job.id,
                          state: job.state === "saved" ? "new" : "saved",
                        })
                      }
                    >
                      <Bookmark />
                      {job.state === "saved" ? "Unsave" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          action: "state",
                          postingId: job.id,
                          state:
                            job.state === "dismissed" ? "new" : "dismissed",
                        })
                      }
                    >
                      {job.state === "dismissed" ? <RefreshCw /> : <X />}
                      {job.state === "dismissed" ? "Restore" : "Dismiss"}
                    </Button>
                  </FieldGroup>
                </CardFooter>
              </Card>
            ))
          )}
        </FieldGroup>
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle
              role="heading"
              aria-level={2}
              className="flex items-center gap-2 text-lg"
            >
              <Building2 className="size-5" /> Companies
            </CardTitle>
            <CardDescription>
              {data.watchLimit > 0
                ? `Watch up to ${data.watchLimit} public company boards.`
                : "Upgrade to watch public company boards."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {data.watches.length > 0 && (
              <FieldGroup className="gap-2">
                <CardDescription className="text-xs font-medium uppercase">
                  Watching · {data.watches.length}
                </CardDescription>
                {data.watches.map((company) => (
                  <Item key={company.id} size="sm" className="border-border">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="break-words whitespace-normal">
                        {company.company}
                      </ItemTitle>
                      <ItemDescription className="text-xs">
                        {company.errorCode
                          ? "Board unavailable · we’ll retry"
                          : company.lastSuccessAt
                            ? `Checked ${age(company.lastSuccessAt)}`
                            : "Awaiting first background check"}
                      </ItemDescription>
                    </ItemContent>
                    <Button
                      variant="neutral"
                      size="icon"
                      aria-label={`Stop watching ${company.company}`}
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          action: "watch",
                          boardId: company.id,
                          watching: false,
                        })
                      }
                    >
                      <X />
                    </Button>
                  </Item>
                ))}
              </FieldGroup>
            )}
            <Field>
              <FieldLabel htmlFor="company-search">Find a company</FieldLabel>
              <Input
                id="company-search"
                placeholder="Search companies…"
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <ItemGroup
              className="max-h-[440px] gap-2 overflow-y-auto"
              aria-label="Company directory"
            >
              {data.companies.map((company) => (
                <Item key={company.id} size="sm" className="border-border">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-none break-words">
                      {company.company}
                    </ItemTitle>
                    <ItemDescription className="text-xs">
                      {providerNames[company.provider]}
                    </ItemDescription>
                  </ItemContent>
                  <Button
                    size="sm"
                    variant="neutral"
                    disabled={busy}
                    aria-label={`${company.watched ? "Stop watching" : "Watch"} ${company.company}`}
                    onClick={() =>
                      mutate({
                        action: "watch",
                        boardId: company.id,
                        watching: !company.watched,
                      })
                    }
                  >
                    {company.watched ? <Check /> : "Watch"}
                  </Button>
                </Item>
              ))}
              {!data.companies.length && (
                <CardDescription>
                  No supported companies found. Try another company name.
                </CardDescription>
              )}
            </ItemGroup>
            <CardDescription className="text-xs text-foreground">
              Directory entries may move or retire. A board outage preserves
              your existing results.
            </CardDescription>
          </CardContent>
        </Card>
      </FieldGroup>
      <Dialog open={preferences} onOpenChange={setPreferences}>
        <DialogContent className="onboarding-surface max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Refine your search</DialogTitle>
            <DialogDescription>
              Your next background check will use these preferences.
            </DialogDescription>
          </DialogHeader>
          <DiscoveryPreferences
            data={data}
            busy={busy}
            save={async (targets) => {
              if (
                await mutate({
                  action: "preferences",
                  expectedRevision: data.preferenceRevision,
                  targets,
                })
              )
                setPreferences(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </FieldGroup>
  )
}
function DiscoveryPreferences({
  data,
  busy,
  save,
}: {
  data: DiscoveryData
  busy: boolean
  save: (targets: DiscoveryData["targets"]) => Promise<void>
}) {
  const first = data.targets[0]
  const [titles, setTitles] = useState(
    data.targets.map((t) => t.targetTitle).join("\n")
  )
  const [location, setLocation] = useState(first?.location ?? "")
  const [remote, setRemote] = useState(
    first?.remotePreferred === true ? "remote" : "any"
  )
  const [keywords, setKeywords] = useState(first?.keywords.join(", ") ?? "")
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="discover-targets">
          Target titles · one per line
        </FieldLabel>
        <Textarea
          id="discover-targets"
          value={titles}
          onChange={(e) => setTitles(e.target.value)}
          maxLength={1200}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="discover-location">
          Locations · comma separated
        </FieldLabel>
        <Input
          id="discover-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={500}
        />
      </Field>
      <Field>
        <FieldLabel>Work arrangement</FieldLabel>
        <RadioGroup
          value={remote}
          onValueChange={(v) => setRemote(String(v))}
          className="flex gap-4"
        >
          <Field orientation="horizontal">
            <RadioGroupItem value="any" id="discover-any" />
            <FieldLabel htmlFor="discover-any">Flexible</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem value="remote" id="discover-remote" />
            <FieldLabel htmlFor="discover-remote">Remote only</FieldLabel>
          </Field>
        </RadioGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="discover-keywords">
          Keywords · comma separated
        </FieldLabel>
        <Input
          id="discover-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          maxLength={3000}
        />
      </Field>
      <CardDescription className="text-xs">
        Locations and remote status filter eligibility; they don’t affect the AI
        fit score. Salary preferences are retained, but salary filtering is not
        yet supported.
      </CardDescription>
      <Button
        disabled={busy}
        onClick={() =>
          save(
            titles
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((targetTitle) => ({
                targetTitle,
                location: location.trim() || null,
                remotePreferred: remote === "remote" ? true : null,
                minimumCompensationUsd: first?.minimumCompensationUsd ?? null,
                keywords: keywords
                  .split(",")
                  .map((k) => k.trim())
                  .filter(Boolean),
              }))
          )
        }
      >
        Save preferences
      </Button>
    </FieldGroup>
  )
}
