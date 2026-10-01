# JobSync Cloud

Next.js 16 application with Neon Postgres, Neon Managed Better Auth, and private Neon Object Storage.
The protected application workspace provides server-side identity, onboarding,
resume review, public job discovery, private application tracking, and usage-aware
billing controls. Private resume files use presigned browser uploads and
ownership-checked downloads. Neon Functions validate and extract PDF/DOCX text,
then structure factual drafts through the Vercel AI SDK and official OpenRouter
provider with durable usage accounting. See [Privacy](/privacy) and [Terms](/terms)
for the current user-facing data and service notices.

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
  Resume edits create immutable snapshots under a resume row lock. Manual versions
  reference their original AI draft. `Resume.confirmedVersionId` and `confirmedAt`
  record explicit acceptance; draft status alone never means accepted facts.
- All timestamps use UTC instants (`timestamptz`). JSON uses JSONB; keywords use a
  Postgres text array. Compensation is whole annual USD; AI cost is integer micro-USD.
- Run and reservation idempotency keys are globally unique, including service-owned
  runs. Callers namespace keys by owner, operation, and logical request.
- Processing runs persist retries, leases, checkpoints, and cancellation. The
  shared processing service claims atomically and requires a live lease token for
  every worker mutation; validation metadata and run completion commit together.
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
`/dashboard` and `/onboarding`; `/account` remains deferred. Incomplete users resume
the durable onboarding step before dashboard access.

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

Email/password identity uses Neon Managed Auth. Production verification and
recovery delivery still require a configured email provider; Google sign-in also
requires production OAuth credentials. See the
[production activation checklist](docs/PRODUCTION_ACTIVATION.md) before enabling
those provider flows.

## UI primitives

Existing shadcn components remain available. Add components using pnpm:

```bash
pnpm dlx shadcn@latest add button
```

## Private resume transport

`neon.ts` uses the stable `@neon/config/v1` GA API and preserves existing Auth
and the **private** `jobsync-files` bucket, plus the validation Function and two
triggers described below. It does not change compute sizing, branch protection/TTL,
AI Gateway, or Data API.
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
ones. Scheduled recovery reconciles these records and retries best-effort object cleanup.
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

**Uploaded is transport acceptance only.** A successful deterministic byte
validation leaves this transport status unchanged and sets validation metadata.
Invalid bytes become rejected. Validation itself creates no semantic facts; the subsequent structuring run creates a review-required draft. Reconciliation resolves a stored object key through
Postgres first; event paths alone never establish ownership.

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


## Asynchronous resume validation

`resumeworker` is a Node.js 24 Neon Function with POST `/object-created` and
POST `/recover`. The native `resume-upload-created` trigger watches private
`jobsync-files` keys with prefix `users/` and targets `/object-created`.
Unknown keys are safely ignored; the prefix includes potential future non-resume
objects. The worker resolves `ResumeUpload.objectKey` before storage access,
then uses the persisted owner, declaration, key, and actual size. It never infers
identity from key segments. GET `/api/resume-uploads/{uploadId}` derives the owner
from the verified session and exposes only safe transport/validation state and
an actionable rejection message. Missing and foreign IDs both return 404.

Both handlers require `X-Neon-Trigger-Invocation-Id`, version 1 of the JSON
envelope, matching body `invocation_id`, and the correct trigger/data schema.
Neon strips client-supplied `X-Neon-*` headers at its deployed edge; the header
is trigger-origin attestation, not a secret or owner ID. Local replay can spoof
this header and is only a handler test. Ordinary deployed direct calls cannot
supply it.

**Neon Functions and triggers wake processing; Postgres owns durable run state.
They are not treated as a durable queue.** Duplicate or interrupted invocations
are expected; no undocumented delivery, retry, exactly-once, or strict scheduling
guarantee is assumed. The canonical kind is `resume_validate_v1`, with key
`user:{ownerUserId}:resume-validate:v1:{uploadId}`. An atomic Postgres upsert
returns the existing logical run and never resets terminal work.

Claims use short transactions, `FOR UPDATE SKIP LOCKED`, a fresh UUID lease,
a 120-second lease, and incremented attempts. The first `startedAt` is preserved.
A short transaction advisory lock makes the concurrency budgets atomic: at most
five live runs globally and two per owner. Every renewal, checkpoint, retry,
completion, failure, and cancellation requires ID, current token, running state,
and an unexpired lease according to Postgres time. No transaction spans downloads
or parsing. Completion and upload validation metadata are one transaction.

Transient infrastructure errors use sanitized `dependency_unavailable`, future
`retry_wait`, and exponential backoff: 30 × 2^(attempt−1) seconds, base capped at
900 seconds, with 0.75–1.25 jitter. There are five maximum claims, including expired
lease reclaims. A fifth-attempt crash is swept to `attempts_exhausted`; failed
runs do not restart automatically. Cancellation is checked before download,
after download, after validation, and atomically at terminal writes.

Permanent validation errors atomically reject the upload and fail the run with
a stable domain code. Invalid-object deletion is best effort and cannot reverse
rejection; bounded recovery also retries cleanup. A canceled run leaves the
transport record unchanged. No customer-facing retry/cancel control is included.

`ResumeUpload` adds nullable `validationCompletedAt` (timestamptz),
`detectedFormat` (pdf/docx enum), and `contentSha256` (64 lowercase hex).
The hash is computed with Node crypto only after successful validation. SQL
checks require paired hash/format and terminal validation time; all previous
transport checks remain. Invalid content has no hash or detected format.
Migration: `20260930190000_resume_validation`.

Validation limits are centralized in `lib/validation/constants.ts`:

- Download: 5 MiB plus one sentinel byte via a bounded Range request; stream
  accumulation stops at 5 MiB and must match the persisted actual size.
- PDF: exact `%PDF-` signature, matching declaration, unpdf 1.8.1/PDF.js
  structural parsing with `stopAtErrors`, all page operator lists validated,
  at most 100 pages, no OCR/text retention. Encrypted PDFs, including empty user
  passwords, are rejected. A terminable 256 MiB Node worker thread enforces
  a 15-second parser deadline. Parser package loading failures retry; corrupt,
  encrypted, excessive/timeout documents are permanent content failures.
- DOCX: classic single-disk ZIP only, valid EOCD/complete central directory/local
  headers, at most 1,000 entries and 100 MiB claimed uncompressed bytes checked
  **before** inflation. Reject Zip64, unsupported flags/methods, encryption,
  malformed descriptors, overlaps, duplicate/unsafe paths, and integer/bounds
  anomalies. Bounded in-memory store/deflate validation checks actual lengths
  and CRCs. Required package XML (`[Content_Types].xml`, `_rels/.rels`,
  `word/document.xml`) is limited to 1 MiB each, syntax-validated with
  fast-xml-parser 5.11.2, rejects DTD/entities, and must identify a Word main
  document/body. No archive entry is written to disk.

The hourly `resume-recovery` cron is **`17 * * * *` UTC**, targeting `/recover`.
It reconciles up to five old pending uploads, repairs up to five missing runs,
processes at most five due/expired runs, and retries up to five rejected/expired
object deletions. Storage modification time permits recovery of objects uploaded
within their signing window despite delayed events; abandoned or late uploads
expire. Millisecond/second storage timestamp precision is accounted for.

The hourly cadence is provisional while there are no users. Scheduled triggers
wake the Function/database even from scale-to-zero. Before launch measure event
loss/retry behavior, recovery latency, Function cost, and database wake cost; then
choose the production cadence. Child branches inherit triggers disabled; enable
them deliberately only on isolated test branches.

The browser polls immediately, then backs off to five-second intervals and stops
after about 90 seconds. Each request has a five-second timeout. Polling aborts on
unmount/change. Users can leave the page; processing continues in Neon. Revisiting
the page checks the latest owner-qualified upload. Successful validation now chains the bounded AI draft workflow described below. Extracted source text stays transient.

### Runtime boundaries and local workflow

`lib/backend` factories accept explicit DB/S3 configuration, import no Next.js,
React, or `server-only`, and read no application environment. `lib/domain`
contains the shared upload/run logic. Existing Next `lib/db.ts` and
`lib/storage/*` adapters remain guarded with `server-only`; browser components
import only the credential-free file constants/schema. The Function validates
only Neon-injected `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_ENDPOINT_URL_S3`, and `AWS_REGION`. It needs neither
`NEON_AUTH_COOKIE_SECRET` nor `APP_ORIGIN`. unpdf is explicitly staged as an
external Function package so the isolated parser thread can resolve it.

```bash
pnpm db:deploy                 # explicitly verified isolated database
pnpm worker:test               # real Postgres plus infrastructure-boundary tests
pnpm validation:test           # tiny sanitized PDF/DOCX/encryption fixtures
neon config plan
neon deploy --no-env-pull       # verified isolated branch only
neon dev                       # resumeworker at localhost:8787
node --conditions=react-server --import tsx scripts/worker-local-proof.ts
neon functions list
neon triggers list
neon logs query --source function --since 30m --limit 100
```

The CLI currently requires declared triggers to exist before `neon dev`.
For pre-deploy testing, use a temporary local `neon.ts` that preserves Auth,
the existing private bucket, and the Function's externalPackages/dev declarations
but omits triggers. Keep the same explicitly verified isolated branch context.
This does not change remote infrastructure.

Local replay envelope (only against `neon dev`):

```json
{
  "version": 1,
  "invocation_id": "local-test-1",
  "trigger": { "type": "storage_object_created", "id": "local-test", "name": "local-test" },
  "data": { "bucket_name": "jobsync-files", "object_key": "persisted-test-object-key" }
}
```

POST it to `http://localhost:8787/object-created` with
`X-Neon-Trigger-Invocation-Id: local-test-1`. For `/recover`, use
`trigger.type: "schedule"` and `data: { "scheduled_at": "2026-09-30T23:17:00Z" }`.
No storage credentials, signed URLs, file bytes/content, or raw dependency errors
belong in logs. Retention is provider-limited; use sanitized run/upload/invocation
IDs, kind, attempt, status, duration, and error codes for correlation.

The optional actual-schedule proof requires temporarily deploying a minute cron
on the approved isolated branch, then restoring the hourly config and deploying
again. It only mutates its own tagged fixture and cleans it in `finally`:

```bash
JOBSYNC_WORKER_LIVE_BRANCH=lively-shape-65452824/br-tiny-tree-b44fo1lv \
  node --conditions=react-server --import tsx scripts/worker-schedule-proof.ts
```

Current official references: [Functions](https://neon.com/docs/compute/functions/overview),
[triggers and attestation](https://neon.com/docs/compute/functions/triggers/overview),
[Function environments](https://neon.com/docs/compute/functions/environment-variables),
[runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits),
[unpdf](https://github.com/unjs/unpdf).

## Resume structuring and AI accounting

See [AI workflow handoff](docs/RESUME_AI_HANDOFF.md) for the architecture, migration,
privacy/routing research, failure semantics, live cost evidence and release checks.

The same `resumeworker` Function now chains a separate `resume_structure_v1` run
following successful validation. Recovery discovers validated uploads missing that
run. Existing Postgres leases, concurrency caps, cancellation and scheduled wakes
remain authoritative; no browser, external queue or Neon AI Gateway is required.

Set server-only `OPENROUTER_API_KEY` in `.env.local`. Supply it to Function config
via the environment when planning/deploying; never commit or expose it to users:

```bash
neon deploy --env .env.local --no-env-pull # explicitly verified isolated branch only
pnpm ai:test                           # deterministic fixtures + real Postgres accounting
JOBSYNC_AI_LIVE_BRANCH=lively-shape-65452824/br-tiny-tree-b44fo1lv pnpm ai:live-proof
```

AI SDK 7.0.126 and the official OpenRouter provider 3.1.0 are pinned. Model and
routing live only in `lib/ai/config.ts`: GPT-6 Luna via Azure, mandatory ZDR,
`data_collection: deny`, strict structured output, required parameter support,
no fallback, no SDK retries, 6,000 output tokens and a 60-second deadline.

The database `AiBudgetPolicy` row `resume` controls the immediate kill switch,
10 starter operations/month, $1 owner monthly ceiling, and $5 global daily ceiling.
These are internal starter allowances, not subscription entitlements. Admission
includes unresolved holds from prior days/months. Disable `enabled` to stop new
reservations and dispatches; already-dispatched calls still reconcile.

A committed in-flight usage marker precedes every provider request. Provider
receipts are captured before output validation, and accepted drafts/run completion
and final accounting commit together. Missing cost or ambiguous outcomes remain
`reconciliation_required`; expiry never implies zero cost or a refund. Generation
IDs permit read-only OpenRouter billing reconciliation. No-ID ambiguity requires
operator review and never triggers another paid request.

The draft stores strict source-grounded data and short evidence passages, with
upload/run ownership-qualified foreign keys, the exact SHA-256, extraction/prompt/
schema versions, and unique source operation. Full extracted text, prompts and
responses are not retained or logged. Unknown fields remain null; dates and facts
are verbatim. Users must review associations and extraction completeness against
the original file. The onboarding review creates versioned corrections and requires
explicit confirmation before target preferences can complete account setup.

See [the onboarding handoff](docs/RESUME_ONBOARDING_HANDOFF.md) for state transitions,
concurrency, parser choices, deployment, and verification.

## Shared job discovery

`/dashboard/discover` lets onboarded users watch supported ATS companies and
organize personalized results. Public jobs are shared; preferences, matches and
actions are private. See [discovery handoff](docs/DISCOVERY_HANDOFF.md) and
[provider/upstream research](docs/DISCOVERY_RESEARCH.md) for bounds, ownership,
versioning, costs and proof limitations.

```bash
pnpm db:deploy
pnpm discovery:seed
pnpm discovery:test
pnpm test
neon deploy --env .env.local --no-env-pull
JOBSYNC_DISCOVERY_LIVE_BRANCH=lively-shape-65452824/br-tiny-tree-b44fo1lv pnpm discovery:live-proof
```

`discoveryworker` runs every five minutes from Neon. It refreshes only watched
public boards at six-hour intervals and bounds private GPT-6 Luna matching to
three calls per user per UTC day, with durable allowance/cost accounting.
The OpenRouter key stays in the Function environment and is not needed by Vercel.

## Private application tracker

Discover openings can now become private applications, while jobs found elsewhere
can be added manually at `/dashboard/jobs`. Both paths share editable details,
six hiring statuses, named stages, durable movement history, follow-up dates and
next actions. Saved Discover cards remain separate from tracked applications.
The dashboard shows real application counts, follow-ups and movement.

See [application tracking handoff](docs/APPLICATIONS_HANDOFF.md) for the snapshot
model, owner isolation, confirmed resume associations, retry/revision rules,
tests, deployment and production proof. Tracking is deterministic and adds no AI
calls or automatic applications.
