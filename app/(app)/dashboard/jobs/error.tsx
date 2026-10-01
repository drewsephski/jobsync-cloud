"use client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
export default function JobsError({ reset }: { reset: () => void }) {
  return (
    <Alert className="onboarding-surface" role="alert">
      <AlertDescription>
        Applications could not be loaded. Your saved data is safe.
      </AlertDescription>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </Alert>
  )
}
