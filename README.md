# JobSync Cloud

Next.js 16 application with Neon Postgres, Neon Managed Better Auth, and private Neon Object Storage.
The protected `/dashboard` establishes the server-side identity and application
profile boundary. `/dashboard/resume` provides direct presigned browser uploads
and ownership-checked private downloads. Functions/triggers, AI, billing, and the
final application shell are deferred.

Use Node.js 22.12+ or 24 LTS and pnpm (the repository pins pnpm in `package.json`).

```bash
pnpm install
pnpm dev
```

## Database configuration

Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your isolated Neon
development database's pooled connection string. Also set `NEON_AUTH_BASE_URL`
to that branch's managed auth endpoint (including `/auth`) and
`NEON_AUTH_COOKIE_SECRET` to a random secret of at least 32 characters. Runtime
configuration is validated once with variable-name-only errors. Credentials stay
in ignored local
environment files; never use a `NEXT_PUBLIC_` variable for database access.

`DATABASE_URL_UNPOOLED` is optional and overrides the connection used by Prisma CLI.
When absent, the CLI derives Neon's direct hostname by removing `-pooler` from the
Neon endpoint hostname in `DATABASE_URL`; other providers use the URL unchanged.
The runtime always uses `DATABASE_URL` with `@prisma/adapter-neon`. This keeps schema
operations off the pooler without requiring another secret. Prisma CLI and smoke
tests load environment files using Next.js's environment loader.

Prisma 7.10 uses `prisma.config.ts` for CLI connections and the `prisma-client`
generator with a local, ignored output directory. Install and build regenerate the
client. No generated client or credentials belong in Git.

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate --name describe_change  # isolated development database only
pnpm db:deploy                       # apply committed migrations, including initial setup
pnpm db:studio
pnpm db:smoke                        # read-only adapter/connection/table check
pnpm db:test                         # integration checks; all test writes roll back
pnpm lint
pnpm typecheck
pnpm build
```

Do not use `db push` or reset a populated database as a migration workflow. Review
migration SQL before applying it. The initial migration was generated with
`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, then
reviewed and applied with `prisma migrate deploy`. Existing `neon_auth` tables are
outside the application schema and must remain managed by Neon.

## Persistence boundaries

- `UserProfile.id` is the managed-auth identity ID; no auth tables are modeled.
  Protected pages provision the profile lazily from the verified server session
  using a parameterized atomic Postgres `INSERT ... ON CONFLICT ... RETURNING`.
  Existing app profile edits and timestamps are preserved. Concurrent first requests
  return one row under the managed-auth ID; no auth webhooks or migrations are needed.
- Resume/version and reservation/usage links use ownership-qualified foreign keys.
  Resume edits create new version snapshots; version content immutability and
  monotonic allocation beyond the unique positive version number must be enforced
  by the future application write path. No active-version pointer is introduced yet.
- All timestamps use UTC instants (`timestamptz`). JSON uses JSONB; keywords use a
  Postgres text array. Compensation is whole annual USD; AI cost is integer micro-USD.
- Run and reservation idempotency keys are globally unique, including service-owned
  runs. Future callers must namespace keys by owner, operation, and logical request.
- Processing runs persist retries, leases, checkpoints, and cancellation. Future
  workers must claim atomically and qualify checkpoints/completion by the current
  lease token. The schema alone does not implement stale-worker protection or retries.
- Accounting distinguishes unknown final usage/cost (`null`) from confirmed zero.
  Reconciliation is explicit; expiration never implies an automatic refund.
- Deletes restrict dependent records so future account cleanup can reconcile work
  and accounting deliberately. Database ownership constraints do not replace
  authorization in the future server application.
- The initial migration includes Postgres CHECK constraints for positive versions,
  nonnegative accounting/attempts, paired leases, running leases, and billing periods.
  Prisma does not model these checks; preserve them in subsequent migrations.

`lib/db.ts` and `lib/db-health.ts` are server-only. Database callers in Next.js must
use the Node runtime. The smoke/test scripts enable Node's `react-server` condition
so the same guarded server module can run outside Next.js. No public health route
or browser database API is exposed.

## Authentication foundation

Neon Auth is the sole identity provider; its `neon_auth` schema is never modeled or
modified by application migrations. Email/password signup and signin redirect to
`/dashboard`; server-side signout uses the SDK and redirects to `/auth/sign-in`.
`/`, `/auth/sign-in`, `/auth/sign-up`, and `/api/auth/*` remain public. Proxy guards
`/dashboard`, `/onboarding`, and `/account` (the latter two are future routes).

Use `getCurrentAuthUser()` from `lib/auth/context.ts` for nullable verified identity
in future API handlers (return 401 on null), or `requireCurrentAuthUser()` for pages.
`requireCurrentProfile()` also ensures the application profile. These functions
accept no browser owner ID. Application components receive no session tokens; provider errors
raise sanitized failures, never normal logout. Server lookups bypass the SDK's
cookie session cache, with request-scoped React memoization. Every private operation
must authorize independently of proxy/layout and use the authenticated ID in
ownership-qualified queries. The branded `CurrentAuthUser` type helps prevent
accidental unverified provisioning; it does not replace runtime authorization.

The proxy also bypasses cookie-session caching so revoked sessions redirect before
reaching read-only Server Components. The SDK is still only an early route guard.

`pnpm auth:test` covers the session boundary, redirects/actions, input validation,
and configuration errors without contacting Neon. `pnpm db:test` includes real
Postgres profile provisioning and independent concurrent requests. Rollback tests
leave no writes; concurrency tests delete their unique test profile in `finally`.
Use an isolated development database for these checks.

This is an early auth foundation, **not production-complete authentication**.
Before launch, configure trusted domains and application name, production OAuth
credentials, a custom email provider, verification and recovery flows, and disable
localhost in production. Google OAuth and email infrastructure are deferred.

## UI primitives

Existing shadcn components remain available. Add components using pnpm:

```bash
pnpm dlx shadcn@latest add button
```

## Private resume transport

`neon.ts` uses the stable `@neon/config/v1` GA API and declares only existing Auth
and the **private** `jobsync-files` bucket. It does not change compute sizing,
branch protection/TTL, or declare Functions, triggers, AI Gateway, or Data API.
Link the CLI to the explicitly verified isolated development project/branch first;
a branch called `production` is not evidence of isolation. Review the plan and
ensure the existing Managed Better Auth integration is preserved before deploying.

```bash
neon config plan
neon deploy
neon env pull
pnpm storage:configure
pnpm storage:smoke
pnpm storage:test
```

Pull `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and
`AWS_REGION` into ignored local environment files. Set server-only `APP_ORIGIN`
to the exact application origin, e.g. `http://localhost:3000` (no trailing slash).
Never expose storage credentials through `NEXT_PUBLIC_` variables. The bucket
must remain explicitly private. The server-only AWS SDK client uses path-style
access and `requestChecksumCalculation: "WHEN_REQUIRED"` for Neon presigned PUT
compatibility. CORS is applied idempotently through S3, allowing only APP_ORIGIN,
PUT/GET/HEAD, `content-type` and `if-none-match` request headers, and exposing ETag.
No wildcard origins or headers are allowed.

`ResumeUpload` is a transport record, separate from `ResumeVersion`, with
`pending → uploaded | rejected | expired` states. Each intent creates its row
before signing, and creates a Resume in the same transaction when needed.
Ownership-qualified resume foreign keys prevent cross-tenant references. SQL
checks enforce positive declared sizes up to 5 MiB, expiry after creation, allowed
MIME types, and consistent uploaded metadata. Actual size uses BIGINT so even
malicious objects beyond the Postgres integer range can be durably rejected.
Pending records represent abandoned uploads durably; completion expires stale
ones. Scheduled cleanup is deferred.
A signing failure leaves the pending row until expiry; a retry creates a fresh ID.

The server generates immutable keys:
`users/{userId}/resumes/{resumeId}/uploads/{uploadId}/original.pdf` (or `.docx`).
Filenames never influence paths. PDF/DOCX extension and exact MIME must agree,
with sizes greater than zero and at most 5 MiB. PUT capabilities last at most
300 seconds, bounded by the pending record expiry. Both Content-Type and
`If-None-Match: *` are signed; create-only PUT prevents replay from overwriting
accepted bytes. This conditional behavior was verified against the isolated Neon
branch (first PUT 200, replay 412, missing/changed signed header 403); Neon’s public
compatibility table does not currently promise conditional writes, so re-run the
live proof before changing storage providers or relying on new branch behavior.
Do not remove the conditional header or fall back to overwrite-capable PUTs.

POST `/api/resume-uploads` derives the owner from the verified session; request
owner IDs and keys are rejected. POST `/api/resume-uploads/{uploadId}/complete`
checks owner plus ID, HEADs the recorded object, and checks size/type against the
declaration before a conditional pending-state update. Concurrent completions
converge on the winning record. Missing objects remain pending (409); invalid
objects remain rejected even if best-effort deletion fails. POST
`/api/resume-uploads/{uploadId}/download-url` requires the owner and uploaded state,
returns a fresh 60-second GET capability with `Cache-Control: no-store`, and never
persists it. Foreign and missing IDs return equivalent 404 responses. Browser
capability requests also reject an Origin that differs from APP_ORIGIN.

**Uploaded is transport acceptance only.** Content-Type is browser-controlled;
this slice does not prove PDF/DOCX byte validity, ZIP safety, or semantic resume
acceptance. No ResumeVersion, ProcessingRun, extraction, or AI work is created.
The framework-independent reconciliation service has an internal stored-object-key
entry that resolves metadata/ownership from Postgres for the next trusted trigger
slice. Event paths alone never establish ownership.

`storage:smoke` is read-only and writes no objects. `storage:test` uses mocked
storage plus isolated Postgres constraint/concurrency tests; DB fixtures roll back
or are removed in finally. The optional live proof needs a running app and an
explicit branch gate:

```bash
JOBSYNC_STORAGE_LIVE_BRANCH=lively-shape-65452824/br-tiny-tree-b44fo1lv \
  node --conditions=react-server --import tsx scripts/storage-live-proof.ts
```

It verifies the known branch endpoints, aborts if resumes exist, uses temporary
auth identities and an inline tiny PDF, exercises two-user isolation, signed
PUT/GET, replay protection, CORS preflight, and anonymous denial, then deletes only
its tagged test objects/rows/users. It logs no credentials or signed URLs. Actual
browser CORS was separately verified through the `/dashboard/resume` picker flow.
Neon stores lifecycle/versioning configuration without enforcing it; do not rely
on bucket lifecycle or versioning for cleanup or immutability. Branch storage
uses copy-on-write snapshots, so parent data still needs sanitization.

Current official references: [Neon config](https://neon.com/docs/reference/neon-ts),
[Object Storage setup](https://neon.com/docs/storage/get-started),
[S3 compatibility](https://neon.com/docs/storage/s3-compatibility).
