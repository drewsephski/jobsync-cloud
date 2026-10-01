import { Check, Compass, ArrowUpRight, FileText, Clock } from "@/components/ui/animated-icons"
import { Card, CardContent, CardTitle, CardDescription } from "./card"
import { FieldGroup } from "./field"
import { Badge } from "./badge"
import { Item, ItemContent, ItemTitle, ItemDescription } from "./item"

export function ProductPreview() {
  return (
    <FieldGroup className="gap-3">
      <Card className="overflow-hidden border-0 shadow-[0_16px_64px_-20px_rgb(24_34_48_/_0.25)]">
        <CardContent className="space-y-6">
          <FieldGroup className="flex-row items-center justify-between border-b border-border pb-5">
            <CardTitle className="text-sm">Your next opportunity</CardTitle>
            <Compass className="size-4 text-main" />
          </FieldGroup>
          <FieldGroup className="flex-row items-center gap-3 rounded-base bg-main/5 p-3">
            <FileText className="size-5 text-main" />
            <FieldGroup className="gap-0">
              <ItemTitle className="text-sm">Resume confirmed</ItemTitle>
              <CardDescription className="text-xs">
                Your experience guides your search.
              </CardDescription>
            </FieldGroup>
            <Check className="size-4 shrink-0 text-main" />
          </FieldGroup>
          <FieldGroup className="gap-2">
            <CardDescription className="text-sm">
              Northstar · Remote
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              Product designer
            </CardTitle>
            <Badge
              variant="neutral"
              className="mt-2 border-0 bg-main/10 text-main"
            >
              Matches your search
            </Badge>
            <CardDescription>
              Product design, Figma, and design systems match the experience in
              your resume.
            </CardDescription>
          </FieldGroup>
          <FieldGroup className="flex-row items-center justify-between border-t border-border pt-4">
            <CardDescription className="text-xs">
              Relevance based on titles and keywords
            </CardDescription>
            <ArrowUpRight className="size-4 shrink-0 text-main" />
          </FieldGroup>
          <Item className="rounded-base border-0 bg-background">
            <Clock className="size-4 text-main" />
            <ItemContent>
              <ItemTitle className="text-sm">
                Follow up on your application
              </ItemTitle>
              <ItemDescription className="text-xs">
                Tomorrow · next action saved
              </ItemDescription>
            </ItemContent>
          </Item>
        </CardContent>
      </Card>
      <CardDescription className="text-center text-xs">
        Illustrative workspace · sample company and role
      </CardDescription>
    </FieldGroup>
  )
}
