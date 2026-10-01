import type { Metadata } from "next"
import { ArrowRight } from "@/components/ui/animated-icons"
import { PublicShell } from "@/components/ui/public-shell"
import { LinkButton } from "@/components/ui/link-button"
import { FieldGroup } from "@/components/ui/field"
import { CardTitle, CardDescription } from "@/components/ui/card"
import { ProductPreview } from "@/components/ui/product-preview"
import { ProductFaq } from "@/components/ui/product-faq"

export const metadata: Metadata = {
  title: "JobSync Cloud — a clearer path to your next job",
  description:
    "Upload your resume, discover relevant jobs, and keep your search moving. Try JobSync free for 14 days. No card or API key required.",
}
const questions = [
  [
    "What does JobSync actually do?",
    "JobSync brings your resume, relevant job openings, and applications into one workspace. Review your resume, watch companies, and keep notes and follow-ups with each opportunity.",
  ],
  [
    "Does JobSync apply to jobs for me?",
    "No. You choose which roles to pursue and apply on the employer’s site. JobSync helps you find opportunities and keep track of what happens next.",
  ],
  [
    "Which job boards does it search?",
    "JobSync watches supported company career boards on Greenhouse, Lever, and Ashby. Choose companies from the directory in Discover. You can also track a job from anywhere manually.",
  ],
  [
    "What happens to my resume?",
    "Your original file is stored privately. You review and edit an AI draft; only the exact version you explicitly confirm is used for matching. You can download the original, export your workspace, or delete your account in Settings.",
  ],
  [
    "How is AI used?",
    "AI turns a text-based PDF or Word resume into an editable draft and can analyze a bounded number of job matches. Title and keyword relevance is labeled separately from completed AI analysis. You review every resume detail before confirming it.",
  ],
  [
    "Do I need an API key?",
    "No. AI is included within your plan’s allowances. There is nothing to install or configure.",
  ],
  [
    "What happens after the trial?",
    "Your 14-day trial starts after email verification. There is no card required and no automatic charge. Plus is an optional $6/month subscription when upgrades are available. Your saved data remains available; AI and discovery are subject to trial and plan limits.",
  ],
  [
    "Can I cancel anytime?",
    "Yes. Manage an active subscription in Settings. Cancellation takes effect at the end of your paid period.",
  ],
] as const
export default function Landing() {
  return (
    <PublicShell>
      <FieldGroup className="gap-24 sm:gap-32">
        <FieldGroup className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <FieldGroup className="gap-6">
            <CardTitle
              role="heading"
              aria-level={1}
              className="max-w-xl text-5xl leading-[1.08] tracking-[-0.035em] sm:text-6xl lg:text-7xl"
            >
              A clearer path to your next job.
            </CardTitle>
            <CardDescription className="max-w-md text-lg">
              Upload your resume. Discover relevant jobs. Keep the promising
              ones moving.
            </CardDescription>
            <FieldGroup className="w-auto flex-row flex-wrap items-center gap-4 pt-2">
              <LinkButton href="/auth/sign-up" size="lg">
                Start your free trial <ArrowRight />
              </LinkButton>
              <LinkButton href="/pricing" variant="neutral" size="lg">
                14 days free, then $6/month
              </LinkButton>
            </FieldGroup>
            <CardDescription className="text-xs">
              No card required. No automatic trial charge. No API key.
            </CardDescription>
          </FieldGroup>
          <ProductPreview />
        </FieldGroup>
        <FieldGroup className="gap-10">
          <CardTitle
            role="heading"
            aria-level={2}
            className="max-w-xl text-3xl tracking-tight sm:text-4xl"
          >
            Less managing your search.
            <br />
            More moving it forward.
          </CardTitle>
          <FieldGroup className="grid gap-8 md:grid-cols-3">
            {[
              [
                "Upload your resume",
                "A PDF or Word file is all you need. Check your experience and skills, make corrections, and confirm when it’s accurate.",
              ],
              [
                "Discover relevant jobs",
                "Choose companies you like. See openings that connect to your background, with clear reasons to take a closer look.",
              ],
              [
                "Keep your next step close",
                "Track a promising role. Add notes, record interviews, and set a follow-up so nothing slips through the cracks.",
              ],
            ].map(([title, text]) => (
              <FieldGroup
                key={title}
                className="gap-3 border-t border-border pt-6"
              >
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </FieldGroup>
            ))}
          </FieldGroup>
        </FieldGroup>
        <ProductFaq items={questions} />
        <FieldGroup className="items-start gap-5 border-t border-border pt-12">
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-3xl tracking-tight sm:text-4xl"
          >
            Your next chapter starts here.
          </CardTitle>
          <CardDescription>
            Your experience. Your decisions. One place to keep going.
          </CardDescription>
          <LinkButton href="/auth/sign-up" size="lg">
            Start your 14-day trial <ArrowRight />
          </LinkButton>
        </FieldGroup>
      </FieldGroup>
    </PublicShell>
  )
}
