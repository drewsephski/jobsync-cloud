import { billingMode, billingRolloutReady } from "@/lib/billing/entitlements"
import type { Metadata } from "next"
import {
  ArrowRight,
  FileText,
  Compass,
  BriefcaseBusiness,
  Check,
  ShieldCheck,
} from "lucide-react"
import { PublicShell } from "@/components/ui/public-shell"
import { LinkButton } from "@/components/ui/link-button"
import { FieldGroup } from "@/components/ui/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item"

export const metadata: Metadata = {
  title: "JobSync Cloud — your job search workspace",
  description:
    "Review your resume, discover relevant openings, and keep every application moving. Already set up. No Docker, API keys, or configuration.",
}

export default function Landing() {
  const liveBilling = billingMode() && billingRolloutReady()
  return (
    <PublicShell>
      <FieldGroup className="gap-20 sm:gap-28">
        <FieldGroup className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <FieldGroup className="gap-7">
            <Badge className="w-fit" variant="neutral">
              Your search. One workspace.
            </Badge>
            <CardTitle
              role="heading"
              aria-level={1}
              className="max-w-2xl text-5xl tracking-tight sm:text-6xl lg:text-7xl"
            >
              Your job search workspace,
              <br />
              already set up.
            </CardTitle>
            <CardDescription className="max-w-lg text-lg">
              Turn your resume into a draft you can review. Find openings at
              companies you choose. Keep applications and follow-ups together.
            </CardDescription>
            <CardDescription className="font-heading opacity-100">
              No Docker. No API keys. No configuration.
            </CardDescription>
            <FieldGroup className="w-auto flex-row flex-wrap items-center gap-4">
              <LinkButton href="/auth/sign-up" size="lg">
                Start your 14-day trial <ArrowRight />
              </LinkButton>
              <LinkButton href="/pricing" variant="neutral" size="lg">
                See pricing
              </LinkButton>
            </FieldGroup>
            <CardDescription className="text-xs">
              No card required. No automatic charge. Plus is $6/month
              {liveBilling ? "." : " when upgrades open."}
            </CardDescription>
          </FieldGroup>
          <Card>
            <CardHeader>
              <FieldGroup className="flex-row items-center justify-between gap-3">
                <CardTitle>Your next move</CardTitle>
                <Badge variant="neutral">Workflow preview</Badge>
              </FieldGroup>
              <CardDescription>
                A clear path from resume to next action.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup className="gap-4">
                {[
                  {
                    icon: FileText,
                    title: "Review your resume draft",
                    body: "Check the extracted details. Edit, then confirm the version you want to use.",
                  },
                  {
                    icon: Compass,
                    title: "Choose companies to watch",
                    body: "Openings from Greenhouse, Lever, and Ashby boards match your resume and targets.",
                  },
                  {
                    icon: BriefcaseBusiness,
                    title: "Track a promising role",
                    body: "Save an application, record progress, and set your next step or follow-up.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <Item
                    key={title}
                    className="border-2 border-border bg-background"
                  >
                    <Icon className="size-5 shrink-0" />
                    <ItemContent>
                      <ItemTitle>{title}</ItemTitle>
                      <ItemDescription className="line-clamp-none">
                        {body}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
            <CardFooter>
              <Badge>
                <Check /> You stay in control
              </Badge>
            </CardFooter>
          </Card>
        </FieldGroup>
        <FieldGroup className="gap-8">
          <FieldGroup className="max-w-2xl gap-4">
            <CardDescription className="text-xs font-heading tracking-widest uppercase">
              From scattered tabs to a steady search
            </CardDescription>
            <CardTitle
              role="heading"
              aria-level={2}
              className="text-3xl tracking-tight sm:text-4xl"
            >
              A place for the work between applications.
            </CardTitle>
          </FieldGroup>
          <FieldGroup className="grid gap-6 md:grid-cols-3">
            {[
              [
                "Resume, reviewed",
                "Upload a PDF or DOCX. Review an editable AI draft, compare it with the source, and keep a version history. Only your confirmed resume informs matching.",
              ],
              [
                "Discover, directed",
                "Set target titles, locations, and keywords. Watch supported company boards and review relevant openings with explanations and optional AI analysis.",
              ],
              [
                "Jobs, moving",
                "Track an opening from Discover or add a role from elsewhere. Keep notes, application status, follow-up dates, and a next action in one record.",
              ],
            ].map(([title, body]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </FieldGroup>
        </FieldGroup>
        <Card>
          <CardHeader>
            <ShieldCheck className="size-6" />
            <CardTitle role="heading" aria-level={2} className="text-3xl">
              Your experience. Your decisions.
            </CardTitle>
            <CardDescription className="max-w-2xl">
              Resume files live in private storage. AI drafts are yours to check
              and change. JobSync keeps your search organized; you choose when
              and where to apply. Export your workspace or request account
              deletion in Settings.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <FieldGroup className="w-auto flex-row flex-wrap gap-4">
              <LinkButton href="/auth/sign-up">
                Set up your workspace <ArrowRight />
              </LinkButton>
              <LinkButton href="/privacy" variant="neutral">
                How your data is used
              </LinkButton>
            </FieldGroup>
          </CardFooter>
        </Card>
      </FieldGroup>
    </PublicShell>
  )
}
