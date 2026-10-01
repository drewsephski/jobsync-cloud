"use client"
import { useEffect, useRef, useState } from "react"
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
} from "@/components/ui/animated-icons"
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
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
  const companySearch = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  useEffect(() => {
    if (!data.enhancing && !data.monitoring) return
    const controller = new AbortController()
    const startedAt = Date.now()
    let lastPollAt = 0
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || busy) return
      const now = Date.now()
      if (now - startedAt > 90_000 && now - lastPollAt < 15_000) return
      lastPollAt = now
      const current = generation.current
      request(
        query,
        filter,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      )
        .then((next) => {
          if (!controller.signal.aborted && current === generation.current)
            setData(next)
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError(
              "Results could not refresh. Check your connection or press Refresh."
            )
        })
    }, 3_000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [data.enhancing, data.monitoring, query, filter, busy])
  useEffect(() => {
    const controller = new AbortController()
    const current = ++generation.current
    const timer = setTimeout(() => {
      request(
        query,
        filter,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      )
        .then((next) => {
          if (!controller.signal.aborted && current === generation.current)
            setData(next)
        })
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
    generation.current++
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
    generation.current++
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
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
                  ? `Your plan allows ${data.watchLimit} companies. Remove one to add another.`
                  : "Could not save your change. Please try again."
        )
      }
      const result = await response.json()
      if (result.data) {
        setFilter("new")
        setData(result.data)
      } else setData(await request(query, filter))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please try again.")
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldGroup className="onboarding-surface discovery-surface mx-auto max-w-6xl gap-7">
      <FieldGroup className="flex-row flex-wrap items-start justify-between gap-4">
        <FieldGroup className="min-w-0 flex-1 basis-full gap-2 sm:basis-0">
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-3xl sm:text-4xl"
          >
            Discover
          </CardTitle>
          <CardDescription>
            Find roles that connect to your experience. Keep the ones worth
            pursuing.
          </CardDescription>
        </FieldGroup>
        <Button
          disabled={busy || !data.ready}
          onClick={() => mutate({ action: "find" })}
        >
          <Search className={busy ? "animate-pulse" : ""} />{" "}
          {data.counts.new ? "Refresh matches" : "Find jobs"}
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
            Confirm your resume and choose a starting role to find relevant
            jobs.
          </AlertDescription>
          <Button
            className="mt-3"
            nativeButton={false}
            render={<Link href="/onboarding" />}
          >
            Review resume & starting role
          </Button>
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
                <SlidersHorizontal /> Refine search
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
            {data.enhancing && (
              <CardDescription role="status" className="text-xs">
                Adding a closer look to top matches…
              </CardDescription>
            )}
          </FieldGroup>
          {data.jobs.length === 0 ? (
            <Empty className="min-h-80 border-border bg-secondary-background">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle className="text-xl">
                  {filter === "saved"
                    ? "Keep the openings worth a closer look"
                    : filter === "dismissed"
                      ? "Nothing dismissed yet"
                      : busy
                        ? "Finding a useful place to start"
                        : "No close matches yet"}
                </EmptyTitle>
                <EmptyDescription>
                  {filter === "new"
                    ? "We searched current openings using your confirmed resume and target role. Try a broader title or location in Refine search. We keep checking companies you follow in the background."
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
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={
                        busy ||
                        job.watched ||
                        data.watches.length >= data.watchLimit
                      }
                      aria-label={`${job.watched ? "Watching" : "Watch"} ${job.company}`}
                      onClick={() =>
                        mutate({
                          action: "watch",
                          boardId: job.boardId,
                          watching: true,
                        })
                      }
                    >
                      {job.watched ? <Check /> : <Plus />}{" "}
                      {job.watched ? "Watching company" : "Watch this company"}
                    </Button>
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
                  <Badge variant="neutral">
                    {job.stale
                      ? "From an earlier search"
                      : "Matches your search"}
                  </Badge>
                  <CardDescription className="text-sm leading-relaxed">
                    {job.reasons.join(". ")}.
                  </CardDescription>
                  <Alert
                    className="review-guidance min-h-32"
                    aria-live="polite"
                  >
                    <AlertTitle className="text-sm">
                      {job.aiScore !== null
                        ? `AI match · ${job.aiScore}/100 · ${job.recommendation}`
                        : job.stale
                          ? "Search updated"
                          : "Why this is worth a look"}
                    </AlertTitle>
                    <AlertDescription className="mt-2 line-clamp-3">
                      {job.aiScore !== null
                        ? job.rationale
                        : job.stale
                          ? "Your resume, preferences or this posting changed. Refresh matches to review current relevance. Your saved job stays here."
                          : "Selected using your role and skills. A closer AI review may be added to top matches; you can explore this opening now."}
                    </AlertDescription>
                  </Alert>
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
              <Building2 className="size-5" /> Companies you follow
            </CardTitle>
            <CardDescription>
              {data.watchLimit > 0
                ? `Follow up to ${data.watchLimit} companies for future openings. Your search works without following any.`
                : "Open Account & billing to follow companies."}
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
                          ? "Temporarily unavailable · we’ll retry"
                          : company.lastSuccessAt
                            ? `Checked ${age(company.lastSuccessAt)}`
                            : "Checking openings in the background…"}
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
                ref={companySearch}
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
              {data.companies.slice(0, query.trim() ? 30 : 0).map((company) => (
                <Item key={company.id} size="sm" className="border-border">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-none break-words">
                      {company.company}
                    </ItemTitle>
                    <ItemDescription className="text-xs">
                      Monitor future openings
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
              {query.trim() && !data.companies.length && (
                <CardDescription>
                  No supported companies found. Try another company name.
                </CardDescription>
              )}
            </ItemGroup>
            <CardDescription className="text-xs">
              {query.trim()
                ? "Follow an employer to keep checking its public openings."
                : "Have a company in mind? Following it adds ongoing monitoring to your search."}
            </CardDescription>
          </CardContent>
        </Card>
      </FieldGroup>
      <Dialog open={preferences} onOpenChange={setPreferences}>
        <DialogContent className="onboarding-surface max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Refine your search</DialogTitle>
            <DialogDescription>
              Choose what you want next. These preferences guide new results.
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
