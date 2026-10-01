import { PublicShell } from "@/components/ui/public-shell"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card"
import { LinkButton } from "@/components/ui/link-button"
export default function AccountClosed() {
  return (
    <PublicShell>
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-3xl">
            Your account is closing.
          </CardTitle>
          <CardDescription>
            Your workspace is locked and outstanding work is canceled. We’re
            removing your private records, stored resume files, billing
            customer, and sign-in account. If a provider is unavailable, cleanup
            retries in the background. Shared public job postings stay
            available.
          </CardDescription>
          <CardDescription>
            This request is permanent. Minimal cleanup and anonymous spend
            records remain to prevent canceled work from returning and preserve
            service safeguards.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <LinkButton href="/" variant="neutral">
            Back to JobSync Cloud
          </LinkButton>
        </CardFooter>
      </Card>
    </PublicShell>
  )
}
