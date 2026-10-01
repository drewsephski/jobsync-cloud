import { PublicShell } from "@/components/ui/public-shell"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { LinkButton } from "@/components/ui/link-button"
import { supportContact } from "@/lib/support"
export const metadata = { title: "Support" }
export default function Support() {
  const contact = supportContact()
  return (
    <PublicShell>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            Support
          </CardTitle>
          <CardDescription>
            Help with billing, account deletion, privacy and data requests, or
            security concerns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {contact.operator && (
              <CardDescription>Operated by {contact.operator}.</CardDescription>
            )}
            {contact.email ? (
              <>
                <CardDescription>
                  Contact us privately by email. Include a short description and
                  the account email you want us to check. We’ll verify ownership
                  before making account changes. Never send your password,
                  payment-card details, sign-in codes, or access links.
                </CardDescription>
                <LinkButton className="w-fit" href={`mailto:${contact.email}`}>
                  Email {contact.email}
                </LinkButton>
              </>
            ) : (
              <CardDescription>
                A private support email has not been published yet. JobSync is
                not open for public launch. Invited testers should use the
                private contact supplied with their invitation for account,
                billing, privacy, or security requests. Please keep private
                information out of public GitHub issues.
              </CardDescription>
            )}
            <LinkButton
              variant="neutral"
              className="w-fit"
              href="/dashboard/feedback"
            >
              Give product feedback
            </LinkButton>
            <CardDescription>
              You can export your workspace or request account deletion in
              Settings → Your data.
            </CardDescription>
            <LinkButton
              variant="neutral"
              className="w-fit"
              href="/dashboard/settings?tab=data"
            >
              Account data controls
            </LinkButton>
          </FieldGroup>
        </CardContent>
      </Card>
    </PublicShell>
  )
}
