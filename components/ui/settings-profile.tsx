"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth/client"
import { signOut } from "@/app/auth/actions"
import { settingsRequest } from "./settings-request"
import { Button } from "./button"
import { LinkButton } from "./link-button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { Field, FieldLabel, FieldGroup } from "./field"
import { Input } from "./input"
export type SettingsOperation = (
  operation: () => Promise<unknown>,
  message: string
) => Promise<void>
export function SettingsProfile({
  name,
  timezone,
  email,
  busy,
  run,
}: {
  name: string
  timezone: string
  email: string | null
  busy: boolean
  run: SettingsOperation
}) {
  const [displayName, setName] = useState(name)
  const [zone, setZone] = useState(timezone)
  const router = useRouter()
  return (
    <>
      <FieldGroup className="gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>{email}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await settingsRequest("/api/account", "PATCH", {
                    displayName,
                    timezone: zone,
                  })
                  router.refresh()
                }, "Profile saved.")
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={200}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
                  <Input
                    id="timezone"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    required
                    placeholder="America/Chicago"
                  />
                  <CardDescription className="text-xs">
                    Used for application dates and follow-ups. For example,
                    America/Chicago or Europe/London.
                  </CardDescription>
                </Field>
                <Button className="w-fit" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save profile"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sign-in & security</CardTitle>
            <CardDescription>
              Neon Managed Auth secures your sign-in. Use a unique password and
              keep access to your email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="[container-type:normal] w-auto flex-row flex-wrap gap-3">
              <LinkButton variant="neutral" href="/auth/forgot-password">
                Reset password
              </LinkButton>
              <Button
                variant="neutral"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await authClient.revokeOtherSessions()
                    if (result.error)
                      throw new Error(
                        "Other sessions could not be signed out. Try again."
                      )
                  }, "Other sessions signed out. This session stays active.")
                }
              >
                Sign out other sessions
              </Button>
              <form action={signOut}>
                <Button variant="neutral" type="submit">
                  Sign out
                </Button>
              </form>
            </FieldGroup>
          </CardContent>
        </Card>
      </FieldGroup>
    </>
  )
}
