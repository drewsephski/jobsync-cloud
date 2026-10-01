"use client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <FieldGroup className="gap-5">
      <Alert variant="destructive">
        <AlertTitle>Your workspace couldn’t load.</AlertTitle>
        <AlertDescription>
          Your saved records are safe. Try loading this page again.
        </AlertDescription>
      </Alert>
      <Button className="w-fit" onClick={reset}>
        Try again
      </Button>
    </FieldGroup>
  )
}
