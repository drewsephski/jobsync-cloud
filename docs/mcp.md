# JobSync Cloud MCP

JobSync Cloud exposes a private, stateless Streamable HTTP MCP server at `/api/mcp`. Its named, expiring bearer tokens and Settings setup follow the original [Gsync/jobsync MCP setup](https://github.com/Gsync/jobsync#mcp-server-ai-agent-integration) and implementation in [`src/app/api/mcp/route.ts`](https://github.com/Gsync/jobsync/blob/main/src/app/api/mcp/route.ts), [`auth.ts`](https://github.com/Gsync/jobsync/blob/main/src/lib/mcp/auth.ts), and [`tokens.ts`](https://github.com/Gsync/jobsync/blob/main/src/lib/mcp/tokens.ts). Cloud uses its existing private application and resume services rather than upstream's self-hosted database/auth model.

## Enable and connect

1. Apply the committed database migration with `pnpm db:deploy` to the intended deployment database, then deploy the app. Set `APP_ORIGIN` to the exact public origin (no trailing slash). MCP is enabled unless `MCP_ENABLED=false`.
2. Sign in and open **Settings → MCP** (`/dashboard/settings?tab=mcp`).
3. Name the client, choose 30/90/365 days, and select permissions. Read access is always included. Application and resume writes are opt-in. Up to 20 active tokens are allowed per account.
4. Generate the token and copy it immediately. Only its SHA-256 digest is stored; the full token cannot be retrieved later. Copy a client configuration from the same page.

For Codex, add this to your Codex `config.toml`, substituting your deployment origin:

```toml
[mcp_servers.jobsync]
url = "https://YOUR_JOBSYNC_HOST/api/mcp"
bearer_token_env_var = "JOBSYNC_MCP_TOKEN"
```

Set `JOBSYNC_MCP_TOKEN` in the environment used to launch Codex. The CLI equivalent is:

```sh
codex mcp add jobsync --url https://YOUR_JOBSYNC_HOST/api/mcp --bearer-token-env-var JOBSYNC_MCP_TOKEN
```

For a client supporting remote HTTP, the Settings JSON uses `type: "http"`, the endpoint URL, and an `Authorization: Bearer <YOUR_TOKEN>` header. Client-specific transport names vary; select **Streamable HTTP** if offered.

For a stdio client such as Claude Desktop, the Settings bridge configuration runs:

```json
{
  "mcpServers": {
    "jobsync": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://YOUR_JOBSYNC_HOST/api/mcp", "--header", "Authorization: Bearer <YOUR_TOKEN>"]
    }
  }
}
```

Restart/reconnect your client after saving configuration. Use HTTPS for remote deployments. This implementation uses bearer-token setup, not OAuth discovery; choose a client that accepts custom headers or the stdio bridge. Browser cookies cannot authenticate MCP calls.

## Capabilities

| Scope | Tools |
| --- | --- |
| `workspace:read` | `list_applications`, `get_application`, `get_dashboard`, `list_resumes`, `get_resume`, `get_resume_review` |
| `applications:write` | `create_application`, `edit_application`, `transition_application`, `archive_application` |
| `resumes:write` | `save_resume_draft`, `confirm_resume` |

Examples: “Which applications need a follow-up?”, “Show my confirmed resume”, “Record my interview at Acme”, and “Set my next action to email the recruiter on October 5.”

All writes require `userApproved: true`. The assistant is instructed to ask the user to approve the exact changes first; this declaration is a client obligation, not a separate server-hosted consent screen. Tool annotations identify writes. Read-only tokens do not expose write tools.

Application edits require the current `expectedRevision`; stale updates fail with `application_conflict`. Creation requires a UUID `creationKey`, reused on retries to avoid duplicate applications. Editing replaces all details, so the client must read first and preserve unchanged fields. Dates supplied to mutations are `YYYY-MM-DD`; returned database dates may be ISO timestamps. Existing onboarding, entitlement, confirmed-resume attachment, and application lifecycle rules apply. The MCP records applications; it does not submit applications to employers.

Resume edits use `get_resume_review` and its latest `expectedVersionId`, and create immutable drafts of the **current upload's** resume. The user must review and separately approve `confirm_resume`. Historical resume versions remain readable. Original file uploads/downloads and permanent deletion remain in the app. Resume read tools exclude storage keys and signed URLs. No paid AI/provider calls are added by these tools; the connected assistant can analyze the content itself.

Lists and resume history accept `offset` and `limit` (1–50) and return `nextOffset`. Application detail returns the latest 50 history events. `get_dashboard` returns the same follow-up summary as the web dashboard. Resume defaults to its confirmed version, or the latest draft when there is no confirmed version.

## Access lifecycle

Tokens have fixed scopes and expire automatically. Revoke them in Settings to stop subsequent requests. Account deletion revokes all tokens and removes their records during cleanup. Accepted operations already in flight may finish.

Every request verifies the token and account; tools recheck authorization at execution. Ownership is derived only from the token's database record. The endpoint rejects foreign browser origins and unexpected hosts, caps request bodies at 256 KB, and permits 120 requests per token per minute using an atomic Postgres rate window shared by all server instances. Responses are never cached. Stateless transport uses POST/JSON; GET and DELETE return 405 because no persistent SSE stream or session is maintained. Invalid tokens return 401, unavailable/rate-limited tokens return 429 with `Retry-After`, and unexpected service failures return a sanitized 503.

## Verification

Run `pnpm mcp:test`. The runner requires the existing isolated schema-only database in `.env.billingtest`, checks its hostname, and never falls back to the application's production database. Apply the new MCP migration to that test schema before its first run. The tests use the official MCP HTTP client to exercise initialization, scope-filtered tool discovery, application mutations, tenant isolation, stale revisions, resume draft/confirmation, expiry, revocation, account-deletion denial, atomic rate limiting, and HTTP boundaries. `pnpm test` includes this suite.

Also run `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Deployment and connecting a real external assistant remain separate checks from local/isolated database verification.
