import { privateRead } from "@/lib/backend/private-read"
import { createOnboardingService } from "@/lib/domain/onboarding/service"
import { billingSummary } from "@/lib/billing/service"
import Link from "next/link"
import { ArrowUpRight, ArrowRight, Clock, Plus } from "@/components/ui/animated-icons"
import { requireCurrentProfile } from "@/lib/auth/context"
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
  const [data, discover, resume, usage] = await privateRead(() =>
    Promise.all([
      createApplicationService(db).dashboard(user),
      createDiscoveryService(db).read(user),
      createOnboardingService(db).read(user),
      billingSummary(db, user.id),
    ])
  )
  const opportunities = discover.jobs
    .filter((job) => !job.applicationId)
    .slice(0, 3)
  // Urgent follow-ups lead, but upcoming interviews must remain visible too.
  const next = [
    ...data.due,
    ...data.upcoming,
    ...data.preparing,
    ...data.attention,
  ]
    .filter((application, index, all) =>
      all.findIndex((candidate) => candidate.id === application.id) === index
    )
    .slice(0, 5)
  const needsResume = !resume.version?.confirmed
  const hasApplications = data.activeCount > 0 || data.recent.length > 0
  return (
    <FieldGroup className="gap-8">
      <FieldGroup className="gap-3">
        <CardTitle
          role="heading"
          aria-level={1}
          className="text-3xl tracking-tight sm:text-4xl"
        >
          {hasApplications
            ? "Keep things moving."
            : needsResume
              ? "Your next job starts with you."
              : "Let’s find your next opportunity."}
        </CardTitle>
        <CardDescription className="max-w-xl text-base">
          {hasApplications
            ? `${profile.displayName ?? user.name ?? "Welcome"}, here’s what deserves your attention.`
            : needsResume
              ? "Upload your resume and review your background. We’ll help you find roles worth pursuing."
              : "Your resume is ready. Choose a company you like and discover roles that connect to your experience."}
        </CardDescription>
      </FieldGroup>
      {!hasApplications ? (
        <Card className="border-0 bg-main/5 shadow-none">
          <CardHeader>
            <CardTitle className="text-xl">
              {needsResume
                ? "Start with your resume"
                : "Put your experience to work"}
            </CardTitle>
            <CardDescription>
              {needsResume
                ? "A text-based PDF or Word file is all you need. You review every detail before we use it."
                : "Keep a promising opening, track your application, and decide on the next step."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              nativeButton={false}
              render={
                <Link
                  href={
                    needsResume
                      ? "/onboarding"
                      : profile.onboardingCompletedAt
                        ? "/dashboard/discover"
                        : "/onboarding"
                  }
                />
              }
            >
              {needsResume
                ? resume.upload
                  ? "Review resume"
                  : "Upload resume"
                : "Discover jobs"}{" "}
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <FieldGroup className="gap-5">
          <FieldGroup className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle role="heading" aria-level={2} className="text-xl">
              What to work on next
            </CardTitle>
            {data.dueCount > 0 && <Badge>{data.dueCount} follow-ups due</Badge>}
          </FieldGroup>
          <ItemGroup className="gap-3">
            {next.map((a) => (
              <NextApplication key={a.id} application={a} today={data.today} />
            ))}
          </ItemGroup>
          {!next.length && (
            <CardDescription>
              Nothing urgent. Discover a new opportunity or review your
              applications.
            </CardDescription>
          )}
          <Button
            className="self-start"
            nativeButton={false}
            render={<Link href="/dashboard/jobs" />}
          >
            Your applications <ArrowRight />
          </Button>
        </FieldGroup>
      )}
      {hasApplications && needsResume && (
        <CardDescription>
          Review your resume when you’re ready to discover more roles.{" "}
          <Link
            href="/onboarding"
            className="text-main underline underline-offset-4"
          >
            Review resume
          </Link>
        </CardDescription>
      )}
      {hasApplications && (
        <FieldGroup className="grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-4">
          {[
            ["Active applications", data.activeCount],
            ["Applied", data.appliedCount],
            ["In interviews", data.interviewCount],
            ["Offers", data.offerCount],
          ].map(([label, value]) => (
            <FieldGroup key={label} className="gap-1">
              <CardDescription className="text-xs">{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
            </FieldGroup>
          ))}
        </FieldGroup>
      )}
      {!needsResume && (
        <FieldGroup className="grid items-start gap-10 md:grid-cols-2">
          <FieldGroup className="gap-5">
            <CardTitle role="heading" aria-level={2} className="text-lg">
              Fresh from Discover
            </CardTitle>
            <ItemGroup className="gap-2">
              {opportunities.map((job) => (
                <Item key={job.id} className="bg-secondary-background">
                  <ItemContent>
                    <ItemTitle>{job.title}</ItemTitle>
                    <ItemDescription>
                      {job.company} · {job.location}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="icon-sm"
                      variant="neutral"
                      aria-label={`View ${job.title}`}
                      nativeButton={false}
                      render={<Link href="/dashboard/discover" />}
                    >
                      <ArrowUpRight />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
            {!opportunities.length && (
              <CardDescription>
                {discover.watches.length
                  ? "Your companies are being watched. Check Discover for fresh openings and refine your search."
                  : "Choose your first company in Discover. We’ll watch for openings that match your background."}
              </CardDescription>
            )}
            <Button
              className="self-start"
              variant="neutral"
              nativeButton={false}
              render={<Link href="/dashboard/discover" />}
            >
              Open Discover <ArrowUpRight />
            </Button>
          </FieldGroup>
          {hasApplications ? (
            <FieldGroup className="gap-5">
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Recent movement
              </CardTitle>
              <ItemGroup>
                {data.recent.slice(0, 4).map((event) => (
                  <Item
                    key={event.id}
                    className="border-0 border-b border-border px-0"
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
                      <ItemDescription className="text-xs">
                        {event.title} · {event.occurredOn}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="icon-sm"
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
              </ItemGroup>
            </FieldGroup>
          ) : (
            <FieldGroup className="gap-4">
              <CardTitle className="text-lg">
                Already pursuing a role?
              </CardTitle>
              <CardDescription>
                Add a job from anywhere. Keep your notes, dates, and next action
                together.
              </CardDescription>
              <Button
                className="self-start"
                variant="neutral"
                nativeButton={false}
                render={<Link href="/dashboard/jobs" />}
              >
                <Plus /> Add an application
              </Button>
            </FieldGroup>
          )}
        </FieldGroup>
      )}
      <CardDescription className="text-xs">
        {usage.plan === "trial"
          ? "Your trial is active. View your allowances in Settings."
          : usage.plan === "plus"
            ? "JobSync Plus · view your plan in Settings."
            : "View your plan and saved data in Settings."}
      </CardDescription>
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
    <Item className="border-border">
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
        <CardDescription className="text-xs">
          {statusLabels[a.status]}{a.stageName ? ` · ${a.stageName}` : ""}
        </CardDescription>
        {a.followUpOn && (
          <CardDescription
            className={`flex items-center gap-1 text-xs ${a.followUpOn < today ? "text-foreground" : ""}`}
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
