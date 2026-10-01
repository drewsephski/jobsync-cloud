import { PublicShell } from "./public-shell"
import { FieldGroup } from "./field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { LinkButton } from "./link-button"
export function PolicyDocument({
  title,
  intro,
  sections,
}: {
  title: string
  intro: string
  sections: { title: string; paragraphs: string[] }[]
}) {
  return (
    <PublicShell>
      <FieldGroup className="mx-auto max-w-3xl gap-8">
        <FieldGroup className="gap-4">
          <CardDescription>Effective October 1, 2026</CardDescription>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-5xl tracking-tight"
          >
            {title}
          </CardTitle>
          <CardDescription className="text-lg">{intro}</CardDescription>
        </FieldGroup>
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                {s.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                {s.paragraphs.map((p) => (
                  <CardDescription key={p}>{p}</CardDescription>
                ))}
              </FieldGroup>
            </CardContent>
          </Card>
        ))}
        <FieldGroup className="w-auto flex-row flex-wrap gap-4">
          <LinkButton variant="neutral" href="/privacy">
            Privacy
          </LinkButton>
          <LinkButton variant="neutral" href="/terms">
            Terms
          </LinkButton>
          <LinkButton variant="neutral" href="/support">
            Contact & support
          </LinkButton>
        </FieldGroup>
      </FieldGroup>
    </PublicShell>
  )
}
