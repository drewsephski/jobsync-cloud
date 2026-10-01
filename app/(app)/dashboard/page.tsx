import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowUpRight, ArrowRight, Clock, Plus, Search } from "lucide-react"
import { requireCurrentProfile } from "@/lib/auth/context"
import { signOut } from "@/app/auth/actions"
import { db } from "@/lib/db"
import {
  createApplicationService,
  type ApplicationView,
} from "@/lib/domain/applications/service"
import { createDiscoveryService } from "@/lib/domain/discovery/service"
import { statusLabels } from "@/lib/domain/applications/schema"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemGroup,
} from "@/components/ui/item"
import { Badge } from "@/components/ui/badge"
export default async function Dashboard() {
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  const [data, discover] = await Promise.all([
    createApplicationService(db).dashboard(user),
    createDiscoveryService(db).read(user),
  ])
  const opportunities = discover.jobs
    .filter((job) => !job.applicationId)
    .slice(0, 3)
  const next = data.due.length
    ? data.due
    : data.preparing.length
      ? data.preparing
      : data.upcoming.length
        ? data.upcoming
        : data.attention
  return (
    <FieldGroup className="onboarding-surface discovery-surface gap-7 py-6 sm:px-4">
      <FieldGroup className="flex-row flex-wrap items-start justify-between gap-4">
        <FieldGroup className="min-w-0 flex-1 basis-full gap-2 sm:basis-0">
          <CardDescription className="text-xs tracking-widest uppercase">
            Your job search
          </CardDescription>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-3xl sm:text-4xl"
          >
            Keep things moving.
          </CardTitle>
          <CardDescription>
            {profile.displayName ?? user.name ?? "Welcome"}, here’s where your
            search stands.
          </CardDescription>
        </FieldGroup>
        <Button nativeButton={false} render={<Link href="/dashboard/jobs" />}>
          Your applications <ArrowRight />
        </Button>
      </FieldGroup>
      <FieldGroup className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Active applications", data.activeCount],
          ["Applied", data.appliedCount],
          ["In interviews", data.interviewCount],
          ["Offers", data.offerCount],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <CardDescription className="text-xs">{label}</CardDescription>
              <CardTitle className="mt-2 text-3xl">{value}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </FieldGroup>
      <Card className="border-cyan-200!">
        <CardHeader>
          <FieldGroup className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle role="heading" aria-level={2} className="text-xl">
              What to work on next
            </CardTitle>
            {data.dueCount > 0 && (
              <Badge variant="neutral">
                {data.dueCount}{" "}
                {data.dueCount === 1 ? "follow-up due" : "follow-ups due"}
              </Badge>
            )}
          </FieldGroup>
          <CardDescription>
            {data.due.length
              ? "Start with your due follow-ups. Update the next action after you’ve followed up."
              : data.preparing.length
                ? "You’ve saved these opportunities. Decide on a next step or record an application."
                : data.upcoming.length
                  ? "Your next follow-ups are coming up."
                  : data.attention.length
                    ? "Review your active applications and choose the next step."
                    : "Find an opportunity or add a job you’re already pursuing."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {next.length ? (
            <ItemGroup className="gap-2">
              {next.map((a) => (
                <NextApplication
                  key={a.id}
                  application={a}
                  today={data.today}
                />
              ))}
            </ItemGroup>
          ) : (
            <FieldGroup className="flex-row flex-wrap gap-3">
              <Button
                nativeButton={false}
                render={<Link href="/dashboard/discover" />}
              >
                <Search /> Discover jobs
              </Button>
              <Button
                variant="neutral"
                nativeButton={false}
                render={<Link href="/dashboard/jobs" />}
              >
                <Plus /> Add an application
              </Button>
            </FieldGroup>
          )}
        </CardContent>
      </Card>
      <FieldGroup className="grid items-start gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-lg">
              Fresh from Discover
            </CardTitle>
            <CardDescription>
              Current matches you haven’t tracked yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-2">
              {opportunities.map((job) => (
                <Item key={job.id} className="border-slate-100">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="break-words whitespace-normal">
                      {job.title}
                    </ItemTitle>
                    <ItemDescription>
                      {job.company} · {job.location}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
              {!opportunities.length && (
                <CardDescription>
                  {discover.watches.length
                    ? "No untracked matches in your current Discover results. Check back after the next background refresh."
                    : "Watch a company to start seeing relevant openings."}
                </CardDescription>
              )}
            </ItemGroup>
            <Button
              className="mt-4"
              variant="neutral"
              nativeButton={false}
              render={<Link href="/dashboard/discover" />}
            >
              Open Discover <ArrowUpRight />
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-lg">
              Recent movement
            </CardTitle>
            <CardDescription>
              Your recorded application history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-2">
              {data.recent.map((event) => (
                <Item
                  key={event.id}
                  className="border-0 border-b border-slate-100 px-0"
                >
                  <ItemContent>
                    <ItemTitle className="text-sm">
                      {event.company} ·{" "}
                      {event.kind === "created"
                        ? "Started tracking"
                        : event.kind === "archived"
                          ? "Archived"
                          : event.kind === "restored"
                            ? "Restored"
                            : statusLabels[event.toStatus]}
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none text-xs">
                      {event.title}
                      {event.stageName ? ` · ${event.stageName}` : ""} ·{" "}
                      {event.occurredOn}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="icon"
                      variant="neutral"
                      aria-label={`Open application at ${event.company}`}
                      nativeButton={false}
                      render={
                        <Link
                          href={`/dashboard/jobs?application=${event.applicationId}`}
                        />
                      }
                    >
                      <ArrowUpRight />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
              {!data.recent.length && (
                <CardDescription>
                  Track your first job to start your history.
                </CardDescription>
              )}
            </ItemGroup>
          </CardContent>
        </Card>
      </FieldGroup>
      <FieldGroup className="flex-row flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/dashboard/resume" />}
        >
          Review resume
        </Button>
        <form action={signOut}>
          <Button variant="neutral" type="submit">
            Sign out
          </Button>
        </form>
      </FieldGroup>
    </FieldGroup>
  )
}
function NextApplication({
  application: a,
  today,
}: {
  application: ApplicationView
  today: string
}) {
  return (
    <Item className="border-slate-100">
      <ItemContent className="min-w-0">
        <ItemTitle className="break-words whitespace-normal">
          {a.nextAction ||
            (a.status === "saved"
              ? "Prepare your application"
              : a.status === "interview"
                ? "Prepare for your interview"
                : a.status === "offer"
                  ? "Review your offer"
                  : "Set a follow-up or review progress")}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {a.company} · {a.title}
        </ItemDescription>
        {a.followUpOn && (
          <CardDescription
            className={`flex items-center gap-1 text-xs ${a.followUpOn < today ? "text-amber-800" : ""}`}
          >
            <Clock className="size-3" />
            {a.followUpOn < today ? "Overdue · " : ""}
            {a.followUpOn}
          </CardDescription>
        )}
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="neutral"
          nativeButton={false}
          render={<Link href={`/dashboard/jobs?application=${a.id}`} />}
        >
          Open <ArrowUpRight />
        </Button>
      </ItemActions>
    </Item>
  )
}
