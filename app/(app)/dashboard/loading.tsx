import { FieldGroup } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription } from "@/components/ui/card"
export default function Loading() {
  return (
    <FieldGroup role="status" aria-label="Loading workspace" className="gap-7">
      <Skeleton className="h-12 w-48" />
      <CardDescription>Loading your workspace…</CardDescription>
      <FieldGroup className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((key) => (
          <Card key={key}>
            <CardContent>
              <FieldGroup>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-32 w-full" />
              </FieldGroup>
            </CardContent>
          </Card>
        ))}
      </FieldGroup>
    </FieldGroup>
  )
}
