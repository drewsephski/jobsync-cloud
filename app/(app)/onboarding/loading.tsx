import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FieldGroup } from "@/components/ui/field"

export default function Loading() {
  return (
    <FieldGroup
      className="onboarding-surface py-8"
      role="status"
      aria-label="Loading your saved onboarding progress"
    >
      <Card>
        <CardHeader>
          <CardTitle>Loading your saved progress…</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
          </FieldGroup>
        </CardContent>
      </Card>
    </FieldGroup>
  )
}
