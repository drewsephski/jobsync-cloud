"use client"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"

export default function OnboardingError({ reset }: { reset: () => void }) {
  return (
    <FieldGroup className="onboarding-surface py-8">
      <Alert role="alert">
        <AlertTitle>Your saved progress is temporarily unavailable</AlertTitle>
        <AlertDescription>
          Your uploaded file and saved changes remain in your account. Check
          your connection and try again.
        </AlertDescription>
      </Alert>
      <Button className="self-start" onClick={reset}>
        Try again
      </Button>
    </FieldGroup>
  )
}
