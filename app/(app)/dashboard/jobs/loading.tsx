import { FieldGroup } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
export default function JobsLoading() {
  return (
    <FieldGroup
      className="onboarding-surface gap-6 py-6"
      aria-label="Loading applications"
    >
      <Skeleton className="h-10 w-52" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </FieldGroup>
  )
}
