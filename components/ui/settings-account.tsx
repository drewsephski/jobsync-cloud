"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "@/lib/auth/client"
import { Button } from "./button"
import { LinkButton } from "./link-button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { Field, FieldGroup, FieldLabel } from "./field"
import { Input } from "./input"
import { Alert, AlertDescription } from "./alert"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogFooter,
} from "./alert-dialog"
import { settingsRequest } from "./settings-request"
import { SettingsProfile } from "./settings-profile"
import { SettingsTargets } from "./settings-targets"
import { SettingsPlan } from "./settings-plan"
import { SettingsMcp } from "./settings-mcp"
import type { McpTokenView } from "@/lib/mcp/schema"
import type { billingSummary } from "@/lib/billing/service"
import type { DiscoveryData } from "@/lib/domain/discovery/service"

type Summary = Awaited<ReturnType<typeof billingSummary>>
export function SettingsAccount({
  name,
  timezone,
  email,
  summary,
  manage,
  upgrade,
  discover,
  files,
  initialTab,
  checkout,
  mcpTokens,
  appOrigin,
}: {
  name: string
  timezone: string
  email: string | null
  summary: Summary
  manage: boolean
  upgrade: boolean
  discover: DiscoveryData | null
  files: { id: string; fileName: string }[]
  initialTab: string
  checkout?: string
  mcpTokens: McpTokenView[]
  appOrigin: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [password, setPassword] = useState("")
  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await operation()
      setNotice(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again shortly.")
    } finally {
      setBusy(false)
    }
  }
  async function download(id: string) {
    const response = await fetch(`/api/resume-uploads/${id}/download-url`, {
      method: "POST",
    })
    if (!response.ok)
      throw new Error("The original file is unavailable. Try again shortly.")
    const { url } = await response.json()
    window.location.assign(url)
  }
  return (
    <FieldGroup className="gap-7">
      <FieldGroup className="gap-3">
        <CardTitle
          role="heading"
          aria-level={1}
          className="text-4xl tracking-tight"
        >
          Settings
        </CardTitle>
        <CardDescription>
          Your account, search direction, and data. All in one place.
        </CardDescription>
      </FieldGroup>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Tabs
        defaultValue={
          ["account", "targets", "plan", "data", "mcp"].includes(initialTab)
            ? initialTab
            : "account"
        }
        onValueChange={() => {
          setNotice("")
          setError("")
        }}
      >
        <TabsList
          className="mb-5 w-full justify-start sm:w-fit [&_[data-slot=tabs-trigger]]:flex-1 [&_[data-slot=tabs-trigger]]:px-2 sm:[&_[data-slot=tabs-trigger]]:flex-none sm:[&_[data-slot=tabs-trigger]]:px-3"
          aria-label="Settings"
        >
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="plan" aria-label="Plan & usage">
            <span className="sm:hidden">Plan</span>
            <span className="hidden sm:inline">Plan & usage</span>
          </TabsTrigger>
          <TabsTrigger value="data" aria-label="Your data">
            <span className="sm:hidden">Data</span>
            <span className="hidden sm:inline">Your data</span>
          </TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
        </TabsList>
        <TabsContent value="account" keepMounted>
          <SettingsProfile
            name={name}
            timezone={timezone}
            email={email}
            busy={busy}
            run={run}
          />
        </TabsContent>
        <TabsContent value="targets" keepMounted>
          <SettingsTargets discover={discover} busy={busy} run={run} />
        </TabsContent>
        <TabsContent value="plan">
          <SettingsPlan
            summary={summary}
            manage={manage}
            upgrade={upgrade}
            checkout={checkout}
          />
        </TabsContent>
        <TabsContent value="data">
          <FieldGroup className="gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Export your workspace</CardTitle>
                <CardDescription>
                  Download your profile, resume versions, preferences,
                  applications and history, matches, and usage as JSON. Original
                  files are available separately below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <LinkButton
                    className="w-fit"
                    href="/api/account/export"
                    prefetch={false}
                    download="jobsync-cloud-export.json"
                  >
                    Download data export
                  </LinkButton>
                  {files.map((f) => (
                    <Button
                      className="w-fit max-w-full whitespace-normal"
                      variant="neutral"
                      disabled={busy}
                      key={f.id}
                      onClick={() =>
                        void run(
                          () => download(f.id),
                          "Original file download started."
                        )
                      }
                    >
                      Download {f.fileName}
                    </Button>
                  ))}
                  <CardDescription className="text-xs">
                    Exports contain private information. Store them somewhere
                    you trust.
                  </CardDescription>
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Delete account</CardTitle>
                <CardDescription>
                  Permanently close your account, cancel subscriptions, and
                  remove private workspace records and resume files. Outstanding
                  work stops and provider cleanup retries if needed. Export
                  anything you want to keep first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDeleting(true)
                    setError("")
                    setPassword("")
                    setConfirmation("")
                  }}
                >
                  Delete account…
                </Button>
              </CardContent>
            </Card>
            <FieldGroup className="[container-type:normal] w-auto flex-row gap-3">
              <LinkButton variant="neutral" href="/privacy">
                Privacy & data use
              </LinkButton>
              <LinkButton variant="neutral" href="/terms">
                Terms
              </LinkButton>
            </FieldGroup>
          </FieldGroup>
        </TabsContent>
        <TabsContent value="mcp">
          <SettingsMcp initialTokens={mcpTokens} origin={appOrigin} />
        </TabsContent>
      </Tabs>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete your account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Your private data and files will be
              removed, billing canceled, and all sign-in sessions closed. Public
              job postings remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="delete-confirmation">
                Type DELETE MY ACCOUNT
              </FieldLabel>
              <Input
                id="delete-confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="delete-password">
                Current password
              </FieldLabel>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep account</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                busy || confirmation !== "DELETE MY ACCOUNT" || !password
              }
              onClick={() =>
                void run(async () => {
                  await settingsRequest("/api/account", "DELETE", {
                    confirmation,
                    password,
                  })
                  await authClient.signOut().catch(() => undefined)
                  router.replace("/account-closed")
                  router.refresh()
                }, "Account deletion requested.")
              }
            >
              {busy ? "Closing account…" : "Permanently delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldGroup>
  )
}
