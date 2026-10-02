"use client"
import { useState } from "react"
import { Button } from "./button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./card"
import { Field, FieldGroup, FieldLabel } from "./field"
import { Input } from "./input"
import { Textarea } from "./textarea"
import { Checkbox } from "./checkbox"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./select"
import { Alert, AlertDescription } from "./alert"
import { settingsRequest } from "./settings-request"
import { mcpClientConfigs } from "@/lib/mcp/config"
import type { McpScope, McpTokenView } from "@/lib/mcp/schema"

export function SettingsMcp({
  initialTokens,
  origin,
}: {
  initialTokens: McpTokenView[]
  origin: string
}) {
  const [tokens, setTokens] = useState(initialTokens)
  const [name, setName] = useState("")
  const [days, setDays] = useState("90")
  const [applications, setApplications] = useState(false)
  const [resumes, setResumes] = useState(false)
  const [revealed, setRevealed] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const configs = mcpClientConfigs(origin, revealed || undefined)
  async function run(operation: () => Promise<void>) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again shortly.")
    } finally {
      setCheckedAt(Date.now())
      setBusy(false)
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice("Copied.")
    } catch {
      setError("Select the text and copy it manually.")
    }
  }
  return (
    <FieldGroup className="gap-6">
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
      <Card>
        <CardHeader>
          <CardTitle>MCP access</CardTitle>
          <CardDescription>
            Connect your AI assistant to your applications, follow-ups, and
            resume versions. Each token grants access to your private workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mcp-name">Client name</FieldLabel>
              <Input
                id="mcp-name"
                value={name}
                maxLength={100}
                placeholder="e.g. Codex"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-expiry">Expires after</FieldLabel>
              <Select
                value={days}
                onValueChange={(v) => {
                  if (v) setDays(v)
                }}
              >
                <SelectTrigger id="mcp-expiry">
                  <SelectValue>
                    {days === "365" ? "1 year" : `${days} days`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <CardDescription>
              Read access is included. Choose which changes this assistant may
              make with your approval.
            </CardDescription>
            <Field orientation="horizontal">
              <Checkbox
                id="mcp-applications"
                checked={applications}
                onCheckedChange={(v) => setApplications(v === true)}
              />
              <FieldLabel htmlFor="mcp-applications">
                Create and update applications
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="mcp-resumes"
                checked={resumes}
                onCheckedChange={(v) => setResumes(v === true)}
              />
              <FieldLabel htmlFor="mcp-resumes">
                Edit and confirm resume drafts
              </FieldLabel>
            </Field>
            <Button
              className="w-fit"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  setRevealed("")
                  const scopes: McpScope[] = ["workspace:read"]
                  if (applications) scopes.push("applications:write")
                  if (resumes) scopes.push("resumes:write")
                  const result = await settingsRequest(
                    "/api/mcp/tokens",
                    "POST",
                    { name, expiresInDays: Number(days), scopes }
                  )
                  setTokens(result.tokens)
                  setRevealed(result.token)
                  setName("")
                })
              }
            >
              {busy ? "Working…" : "Generate token"}
            </Button>
            {revealed && (
              <FieldGroup>
                <Alert role="status">
                  <AlertDescription>
                    Copy this token now. It is only shown once. Anyone with it
                    can access the permissions you selected.
                  </AlertDescription>
                </Alert>
                <Field>
                  <FieldLabel htmlFor="mcp-token">New token</FieldLabel>
                  <Input
                    id="mcp-token"
                    readOnly
                    value={revealed}
                    autoComplete="off"
                    className="font-mono"
                  />
                </Field>
                <FieldGroup className="[container-type:normal] w-auto flex-row gap-3">
                  <Button variant="neutral" onClick={() => void copy(revealed)}>
                    Copy token
                  </Button>
                  <Button variant="neutral" onClick={() => setRevealed("")}>
                    Hide token
                  </Button>
                </FieldGroup>
              </FieldGroup>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connect your assistant</CardTitle>
          <CardDescription>
            Use {configs.url}. For Codex, set JOBSYNC_MCP_TOKEN in the
            environment that launches Codex. Other clients can use the HTTP
            config; stdio clients can use the bridge config.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {[
              {
                id: "codex",
                label: "Codex · config.toml",
                value: configs.codex,
              },
              {
                id: "remote",
                label: "HTTP client · JSON",
                value: configs.remote,
              },
              {
                id: "claude",
                label: "Claude Desktop · mcp-remote bridge",
                value: configs.claude,
              },
            ].map((config) => (
              <Field key={config.id}>
                <FieldLabel htmlFor={`mcp-config-${config.id}`}>
                  {config.label}
                </FieldLabel>
                <Textarea
                  id={`mcp-config-${config.id}`}
                  readOnly
                  value={config.value}
                  rows={config.id === "codex" ? 3 : 10}
                  className="font-mono text-xs"
                />
                <Button
                  variant="neutral"
                  className="w-fit"
                  onClick={() => void copy(config.value)}
                >
                  Copy{" "}
                  {config.id === "codex"
                    ? "Codex"
                    : config.id === "remote"
                      ? "HTTP"
                      : "bridge"}{" "}
                  config
                </Button>
              </Field>
            ))}
            <CardDescription>
              Ask “Which applications need a follow-up?” or “Show my confirmed
              resume.” Enable application changes to ask “Record my interview at
              Acme.” Your assistant should ask for approval before saving
              changes.
            </CardDescription>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your tokens</CardTitle>
          <CardDescription>
            Revoke access when you stop using a client. Expired or revoked
            tokens cannot connect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {!tokens.length && (
              <CardDescription>No tokens yet.</CardDescription>
            )}
            {tokens.map((token) => (
              <FieldGroup
                key={token.id}
                className="gap-2 border-b pb-4 last:border-b-0"
              >
                <CardTitle className="text-sm break-words">
                  {token.name}
                </CardTitle>
                <CardDescription className="text-xs break-words">
                  {token.tokenPrefix}… · {token.scopes.join(", ")}
                </CardDescription>
                <CardDescription className="text-xs">
                  Expires {token.expiresAt.slice(0, 10)} (UTC) ·{" "}
                  {token.revokedAt
                    ? "Revoked"
                    : new Date(token.expiresAt).getTime() <= checkedAt
                      ? "Expired"
                      : "Active"}
                </CardDescription>
                <CardDescription className="text-xs">
                  Last used:{" "}
                  {token.lastUsedAt
                    ? `${token.lastUsedAt.replace("T", " ").slice(0, 19)} UTC`
                    : "Never"}
                </CardDescription>
                {!token.revokedAt && (
                  <Button
                    className="w-fit"
                    variant="neutral"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await settingsRequest(
                          "/api/mcp/tokens",
                          "DELETE",
                          { tokenId: token.id }
                        )
                        setTokens(result.tokens)
                        setRevealed("")
                        setNotice("Token revoked.")
                      })
                    }
                  >
                    Revoke {token.name}
                  </Button>
                )}
              </FieldGroup>
            ))}
          </FieldGroup>
        </CardContent>
      </Card>
    </FieldGroup>
  )
}
