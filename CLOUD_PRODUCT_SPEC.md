# JobSync Cloud product specification

Status: implementation contract; application and infrastructure changes have not begun.
Date: September 30, 2026.

## 1. Product and scope

**JobSync Cloud** is the hosted product. **JobSync Plus** is its paid subscription.

> Your job search workspace, already set up. No Docker. No API keys. No configuration.

Primary journey: sign up → upload resume → review extracted details → select target roles → receive a resume review and relevant job matches → track applications.

The product owns hosting, authentication, storage, AI configuration, discovery scheduling, and maintenance. Users control their resume content, search preferences, application records, and billing. AI proposes changes; users approve consequential edits. Do not invent employment history, qualifications, job availability, or application submissions.

Launch one bounded plan at a proposed founding price of **US$6/month**. Do not promise unlimited AI, discovery, uploads, or permanent founding-price protection. Final allowances and any price-protection terms must be established before publishing the offer.

V1 excludes teams, recruiter CRM, autonomous applications/outreach, user-supplied provider keys, Ollama, arbitrary model selection, and a generic AI chatbot. Existing secondary domains can be ported after the golden path works.

## 2. Repository and release boundary

- Create a separate product repository, proposed `drewsephski/jobsync-cloud`, from the verified latest `Gsync/jobsync:dev`. Record the starting commit SHA.
- Retain the upstream MIT license and copyright notice, and include visible project credits. Product-name permission is a separate public-launch decision; retain provisional branding until resolved. Do not infer naming permission from the software license.
- Keep `Gsync/jobsync` as an upstream remote for selective fixes. Do not commit to permanent merge compatibility or add cloud conditionals throughout the self-hosted app.
- The current workspace is `drewsephski/jobsync`, with an upstream remote and substantial staged UI/test work. Preserve it. Inventory those changes and selectively carry agreed improvements into the new product; do not reset, overwrite, or silently copy the current tree as the cloud baseline.
- This document is preparation in the current workspace. It does not create a GitHub repository, contact the maintainer, deploy services, or alter the upstream PR branch.
- Keep npm and `package-lock.json` initially, following this repository's tooling. Retain Next.js, TypeScript, Prisma, Zod, Tailwind 4, and shadcn/ui.

## 3. Architecture

| Concern | Decision |
| --- | --- |
| Website, SSR, ordinary actions | Next.js App Router on Vercel |
| UI | shadcn/ui, Tailwind 4, Motion for React |
| Database | Neon Postgres; keep Prisma initially |
| Identity | Neon Managed Better Auth |
| Files | Explicitly private Neon Object Storage buckets |
| Interactive AI | Bounded Next.js streaming routes |
| Asynchronous processing | Neon Functions |
| Scheduling and upload events | Native Neon Function Triggers |
| Durable orchestration | Postgres run records, leases, checkpoints, recovery sweeps |
| AI | Neon AI Gateway primary; OpenRouter adapter/fallback |
| Billing | Stripe Checkout, Portal, verified webhooks |
| Product email | Resend; verify managed-auth email configuration separately |
| Monitoring | Sentry plus structured application/run logs |

Do not move every action into Functions. Put shared business logic in framework-independent domain modules, with thin Next.js and Function handlers. Retain working AI SDK integrations; introduce only the provider boundary needed for generation, streaming, structured output, usage, and error normalization.

Interactive routes must have explicit duration, token, and tool-step budgets. If a workflow exceeds the host budget, persist it as asynchronous work rather than extending a stream indefinitely. A later direct browser-to-Function stream requires verified short-lived tokens and restricted CORS; it must not rely on cookies being shared across unrelated domains.

Use pooled database connections for ordinary traffic and the direct connection for schema migrations as appropriate to Prisma/Neon. Verify Prisma bundling and runtime compatibility in both Vercel and Neon Functions before broad migration.

Start in AWS US East (Ohio), where the selected services are supported, and align Vercel compute where available. Check current regional support and customer requirements before provisioning. Neon service pricing and limits are usage-based; free allowances are not the business model.

## 4. Identity and tenancy

Offer Google first, email magic link second, and email/password as fallback. Configure production OAuth credentials, trusted redirect domains, email verification, recovery, and delivery. Verify each path live; SDK support alone is insufficient.

Cloud identities are new. Do not migrate self-hosted password hashes or NextAuth sessions. Import from JobSync backup is a later, explicit data-import feature that remaps ownership to the signed-in cloud account and excludes credentials.

Use a one-to-one application profile keyed by the managed-auth user ID. Neon owns its auth schema; application migrations must not modify managed tables. Choose and test the account-provisioning mechanism, including concurrent first requests and missed auth events. No organization/team model in v1.

Every private operation must derive the caller from the verified server session or token. Never accept a client-supplied owner as authority. Scope reads, writes, nested relations, batch operations, exports, downloads, logs, cancellation, and AI tool execution to the caller. Use ownership-qualified mutations to avoid check-then-write races. Return a consistent not-found response for inaccessible private IDs.

Private parent-child relations must prevent links between different owners. Add composite constraints where useful and validate remaining relationships transactionally. A user's authorized application may reference a global job posting; it may not reference another user's resume or contact.

The current source already includes ownership guards, for example in `src/actions/profile/shared.ts`, and ownership tests. Preserve and extend them. Multi-user readiness requires auditing every domain, not blindly adding `userId` columns or assuming the existing app has no tenancy protection.

RLS can add defense in depth, but only with a tested role and transaction-scoped identity strategy. A privileged Prisma connection does not automatically inherit the user's auth context or enforce RLS. Do not expose a direct browser Data API until its policy coverage is proven.

## 5. Data ownership and shared discovery

| Scope | Records |
| --- | --- |
| Global, publicly sourced | Company directory, ATS provider, board identity, job posting, board ingestion state |
| User-owned | Profile, resume/version, application, contact, task, activity, document, target preferences, automation, job match, discovered-job decision, conversation, notification |
| Private operational | Subscription, entitlement, usage/reservation ledger, user processing run and events |
| Service-owned operational | Shared ingestion runs, recovery state, billing-event inbox, platform spend counters |

Global means public input, not publicly editable by customers. Only trusted ingestion/admin services update shared postings. Custom user notes and private company/contact details must never enter the shared directory.

Introduce `Application` independently from `JobPosting`. Manual applications can exist without a shared posting. Shared postings retain source URL, provider, board ID, external ID, timestamps, content version/hash, and active/closed state. Enforce uniqueness on provider + board identity + external ID.

Fetch each board once per freshness window, with a shared lease and backoff. Then prefilter deterministically by user preferences before paid AI scoring. Persist matches per user, posting content version, resume version, preferences version, and scoring version. A cached result from another user is never reusable as a private match.

Do not implement full shared ingestion only after writing a separate golden-path ingestion system. Establish these models in the foundation; the golden path uses a limited board set, and phase 5 expands scheduling and scale.

Migrate to Postgres with a new migration history for the cloud product. Review SQLite-specific SQL, JSON conventions, case sensitivity, defaults, transaction behavior, uniqueness, and date handling. Keep timestamps in UTC and scheduling preferences as IANA timezones, including daylight-saving behavior. Do not replay SQLite migrations against Postgres.

## 6. Files and resume processing

Create private buckets explicitly. Store object keys and metadata in Postgres, never permanent signed URLs. Use immutable upload/version keys, for example:

```text
users/{userId}/resumes/{resumeId}/versions/{uploadId}/original.pdf
users/{userId}/exports/{documentId}.pdf
users/{userId}/imports/{uploadId}/source.docx
```

1. An authenticated request checks ownership, file allowance, expected format, and size, then creates a pending upload record and signs one specific immutable key.
2. The browser uploads with a short-lived signed URL. Bucket credentials remain server-side.
3. An object-created trigger validates the trusted invocation using Neon's documented mechanism, validates the payload, and resolves the pre-created upload record. A path alone never establishes ownership.
4. The worker checks actual object metadata/size and file signatures, claims an idempotent processing run, extracts text, performs bounded AI extraction, and saves a draft.
5. The user reviews and confirms extracted facts. Partial/invalid extraction must not overwrite an accepted resume.
6. Review and matches operate on a saved resume version. The UI shows durable progress and allows retry after a recoverable failure.

Signed URL issuance and processing both enforce limits. Where the signing mechanism cannot enforce a byte limit itself, validate before parsing and remove/reject oversized objects. Expired upload records, orphan objects, failed uploads, and stale processing runs need reconciliation. Never reuse an upload key after it has been accepted.

Downloads and generated exports require fresh ownership checks and short-lived signed URLs. Deleting a document/account records cleanup work durably, so object deletion can recover after a crash.

## 7. Durable execution without an external queue

Neon triggers wake handlers; Postgres owns the lifecycle. Do not use in-memory timers, unawaited promises, or `waitUntil` as the durable job mechanism. A browser connection is not required for completion.

Use one reusable processing-run mechanism for resume work, matching, discovery, exports, and cleanup where needed:

```text
processing_runs
id, owner_user_id (nullable for trusted shared jobs), kind, resource_id,
idempotency_key, status, attempt, available_at, lease_token,
lease_expires_at, checkpoint, cancellation_requested_at,
started_at, completed_at, error_code, created_at, updated_at
```

Statuses: `pending`, `running`, `retry_wait`, `succeeded`, `failed`, `canceled`. A unique idempotency key identifies one logical operation; a new user-requested run uses a new key.

- A trigger creates/finds a run idempotently, then processes a bounded batch in the invocation.
- Claim eligible runs atomically, using a short transaction and row locking such as `FOR UPDATE SKIP LOCKED`. Assign a new lease token per claim.
- Do not hold a database transaction open across network/AI calls. Heartbeat long operations, and require the current lease token on checkpoint/completion writes so an expired worker cannot overwrite a replacement worker.
- Check cancellation between units of work. Every persisted side effect has a domain-level deduplication key; leasing alone does not guarantee exactly-once execution.
- Persist checkpoints after completed units. Transient errors retry with capped exponential backoff and jitter. Permanent failures surface an actionable reason; exhausted retries remain visible for support/retry.
- A native scheduled recovery trigger scans pending, retry-due, and expired-lease runs and executes bounded batches. This supplies a recovery path even if an upload event or immediate wake-up was missed. Reconcile pending uploads against actual storage objects too.
- Add per-user concurrency and global concurrency limits to prevent one account consuming the worker budget. Paginate work; do not drain all jobs in one invocation.
- Store progress events in Postgres with a cursor; authorize polling/SSE by owner and stop polling inactive pages. Process-local log maps are not the source of truth.

Assume duplicate events and interrupted invocations; do not assume undocumented delivery, retry, or exactly-once guarantees. Validate deployed trigger authentication, overlapping claims, eviction, stale-worker writes, cancellation, and recovery before launch.

An external queue/workflow engine is justified only by measured recovery latency, orchestration complexity, throughput, or operational burden. Record that decision if the Postgres approach stops being maintainable.

## 8. AI policy, usage, and cost

Neon AI Gateway is the intended default, subject to passing the actual JobSync workflow evaluations. OpenRouter is an explicit adapter/fallback with dedicated production credentials and spend caps. Personal development credentials never serve production. Preview AI uses separate budgets and synthetic data.

Provider configuration is server-owned and versioned: feature → model/provider allowlist → token/tool limits → pricing version → data policy. A fallback must satisfy the same quality, privacy, and cost constraints; never silently route to an unapproved provider.

Evaluate resume extraction accuracy, review usefulness, structured outputs, tool calling, streaming, latency, and total operation cost. Do not select a model on per-token price alone. Keep the existing eval corpus and add cloud-specific cases. No fixed model IDs are committed by this specification.

Ledger entries include user, billing period, feature, provider/model, request ID, idempotency key, input/output/other billable usage, reserved units, settled units, estimated/actual cost in integer micro-USD, pricing version, provider request ID, status, and timestamps. Record every nested call and retry; one chat turn may contain several chargeable calls.

Flow: authenticate → check entitlement → atomically reserve feature units and conservative spend → execute → record actual provider usage → reconcile → save result.

Reservations and limits must work across Vercel instances and Functions. Unknown provider outcome or missing usage must enter reconciliation; never refund automatically if a paid call may have completed. Retry a logical operation without double customer charging, while still recording any real additional provider costs. Expired reservations require an explicit recovery policy.

Enforce per-user monthly/day spend, platform daily spend, concurrency, file/text sizes, output tokens, tool steps, and maximum retries before spending. A platform kill switch blocks new paid inference while preserving tracking, exports, and access to saved results.

Customers see understandable **AI credits**, with operation weights disclosed before use. Do not equate weighted credits with a fixed number of actions. Initial examples: simple interaction = 1 credit, full resume review = 3; these are provisional pending evaluation. Proposed internal monthly AI budget: $1–$1.50 per paid account, not a margin guarantee.

Basic persistent reservations, trial limits, and a platform spending ceiling belong in the golden path before any externally accessible AI. Full subscription integration and the customer usage page follow in phase 4.

## 9. Billing and entitlements

One proposed Plus plan: $6/month, with a bounded AI allowance, bounded discovery frequency/board count, and stated storage limits. Trial is one bounded grant per verified account, not renewable by repeated sign-in. Trial duration and exact allowances remain launch decisions informed by measurements.

Stripe owns payment state; a persisted entitlement model owns application access. Use server-controlled price IDs. Verify webhook signatures against raw bodies, deduplicate event IDs, and handle duplicate/out-of-order delivery by reconciling current subscription state. The checkout return page never grants paid access on its own.

- Active/trial entitlement: allow the configured features and remaining allowance.
- Cancellation at period end: access continues through the paid period.
- Failed payment: proposed three-day grace period after renewal failure, without granting a fresh AI allowance; then pause new paid work. Show recovery through the billing portal.
- Expired/inactive: retain read/export access to existing records; pause paid AI/discovery. Do not silently delete data on cancellation.
- Renewals: grant allowances once per unique billing period/invoice, independently of duplicate events. Do not reset on repeated checkout or plan-state changes.
- Account deletion: stop jobs, revoke sessions, reconcile billing/cancellation, and remove private data/files with durable cleanup. Define statutory billing-record retention separately.

Do not add annual plans or prepaid top-ups to v1 unless needed after usage data. Include gateway fees, inference, Vercel, Neon compute/storage/egress, email, monitoring, refunds, taxes, and support in the cost model. The $6 price is provisional until those costs are measured.

## 10. Privacy and environments

Send only the resume/job content required for a feature. Omit contact details from scoring/review prompts when unnecessary. Never log raw resumes, prompts, responses, credentials, signed URLs, or sensitive tool arguments in default telemetry. Disable content capture and configure Sentry scrubbing.

Review retention/training policies for every approved provider, including Gateway models and OpenRouter routes. Publish a claim only after verifying that the configured services satisfy it. Do not claim universal zero retention or no provider training merely because the app itself does not train models.

Use isolated development and preview auth, storage, Functions, and provider budgets. Branching production copies sensitive data and potentially identities; use a sanitized development parent rather than routinely cloning production into developer/PR environments. Preview triggers must remain disabled unless deliberately enabled for tests; preview email cannot contact real users.

Document retention for originals, rejected drafts, conversations, run logs, abandoned accounts, backups, and billing records before public launch. Build export and deletion verification. Support access must be explicit, least-privileged, and auditable.

## 11. Routes and user experience

| Route | Purpose |
| --- | --- |
| `/` | Product landing page |
| `/pricing` | Founding plan, limits, trial terms |
| `/signin`, `/signup`, `/auth/*` | Managed identity flows |
| `/onboarding` | Resume, confirmation, target roles, first value |
| `/dashboard` | Home and next actions |
| `/dashboard/jobs`, `/dashboard/jobs/[id]` | Applications and details |
| `/dashboard/discover` | Relevant postings, match rationale, accept/dismiss |
| `/dashboard/resume`, `/dashboard/resume/[id]` | Resume versions, review, export |
| `/dashboard/interviews` | Interview preparation |
| `/dashboard/assistant` | Focused assistant; also available as a contextual drawer |
| `/dashboard/settings/*` | Account, preferences, usage, billing, export/deletion |

Primary navigation: Home, Jobs, Discover, Resume, Interviews, Assistant. Keep contacts/tasks/activity secondary and contextual. Retain redirects for any cloud routes renamed after release.

Home answers “What should I do next?” using real user records. Never display fabricated match counts, interviews, testimonials, or follow-ups. First-use empty states guide onboarding; processing states name the current step; failures retain the draft and offer a safe retry.

Onboarding is resumable across reloads/devices. Confirm extracted information before treating it as accepted. Target roles, location/remote preferences, and preferred companies should progressively refine relevance rather than require a large setup form. Users can reach the tracker even while processing runs.

## 12. Design and motion contract

Use existing shadcn patterns and semantic theme tokens. Establish consistent typography, spacing, radii, surfaces, focus states, and density before styling individual pages. Use restrained color and generous space; support light/dark themes and mobile navigation.

Use the `motion` package with `motion/react`. Shared primitives: `AnimatedTabs`, `AnimatedPanel`, `AnimatedList`, `AnimatedDisclosure`, `PageTransition`, and `SlidingIndicator`. Avoid wrappers where normal CSS suffices.

- Sliding indicators use locally scoped layout IDs to prevent collisions across tab groups.
- Panels preserve drafts, selection, focus, scroll, and URL state. Animation must not remount forms unnecessarily.
- Spatial transitions are short, typically 160–240 ms, with subtle offsets. Hover colors and ordinary button feedback remain CSS.
- Respect reduced motion; maintain ARIA tab semantics, keyboard controls, focus management, and accessible dialog behavior.
- Do not animate every route with an exit that blocks navigation or data rendering. Avoid duplicate active panels and layout shifts during transitions.
- Include skeleton, empty, loading, partial, failure, and recovery states in the component contract.

## 13. Evidence inventory: migration gaps and UX investigations

These are source-confirmed cloud gaps, not claims of browser-reproduced bugs in the self-hosted product:

| Evidence | Cloud requirement |
| --- | --- |
| `prisma/schema.prisma` uses SQLite | New Postgres schema/history and reviewed data semantics |
| `src/auth.ts`, `src/auth.config.ts` use credential-based NextAuth | Managed auth, fresh cloud identities, recovery/OAuth flows |
| `src/lib/resumeFiles.ts`, backup modules use filesystem storage | Private objects, metadata, access checks, cleanup |
| `src/instrumentation.ts`, `src/lib/scheduler/index.ts` start node-cron | Native triggers and persistent orchestration |
| `src/app/api/automations/[id]/run/route.ts` launches unawaited work | Durable run creation/claim/recovery |
| `src/lib/automation-logger.ts` holds logs in a process-local map | Durable progress visible across instances |
| `src/lib/ai/rate-limiter.ts` holds limits in memory | Atomic shared reservations and limits |
| `src/app/api/ai/chat/route.ts` requires a selected provider/model | Server-selected cloud AI with actionable quota/provider errors |
| `src/components/settings/AiSettings.tsx` exposes provider setup | Cloud preferences/usage, with provider configuration removed |

**No browser-confirmed UX defect inventory has been established in this planning session.** Do not label suspected problems as discovered bugs. Existing staged UI improvements are work to review, not evidence that those problems remain unfixed.

During shell/golden-path QA, log defects with route, viewport, steps, expected/actual behavior, evidence, priority, and resolution. Investigate mobile navigation, interrupted onboarding, tab state retention, duplicate submissions, stream failures, slow document processing, loading shifts, empty-state clarity, and private-file error recovery. Review the current landing/auth/dashboard tests before carrying existing fixes forward.

## 14. Implementation milestones and acceptance

1. **Separate repo and foundation.** Verify upstream `dev` baseline; preserve/select current improvements; define `neon.ts`; provision isolated environments; migrate Postgres; integrate managed auth; establish shared/private models; configure private storage. Acceptance: two identities cannot access each other's records or files, and migrations work on a clean branch.
2. **Shell and onboarding.** Implement landing/auth/mobile shell and shared Motion primitives; remove provider configuration from the cloud UI. Acceptance: keyboard/reduced-motion/mobile flows work and onboarding state survives reloads.
3. **Golden path.** Upload → trigger → extraction → confirmation → review → target roles → first matches using a limited shared board set. Include basic spend reservations and recovery. Acceptance: closing the browser, duplicate events, and an interrupted worker do not lose or duplicate the result; real AI quality/cost is measured.
4. **Usage and billing.** Complete credits, entitlements, Stripe, grace/recovery, and spend controls. Acceptance: duplicate/out-of-order events and simultaneous AI requests cannot double-grant or overspend; cancel/renewal/failure paths are verified.
5. **Cloud discovery.** Expand shared board ingestion, freshness, versioned matching, scheduled claims, fairness, and progress. Acceptance: users tracking the same board share ingestion, retain private matches, and recover after worker eviction.
6. **Selective domain ports and launch.** Port interviews, cover letters, contacts/tasks/activity, MCP, and backup import as justified. Export/deletion and tenant verification are launch essentials, not optional late features. Repeat two-account checks as each domain becomes available.

For each milestone run npm lint, TypeScript checking, and relevant unit/integration tests, followed by deployed proof for the changed provider lifecycle. Explicitly distinguish local checks, browser checks, deployment, and live provider proof. Test ownership throughout, not only at the end.

Required production proof includes real signup/recovery, authorized private upload/download, trigger invocation, expired-lease recovery and stale-worker rejection, AI reservation races/reconciliation, shared ingestion/private matching, billing event replay, account export/deletion, and monitoring without sensitive content.

## 15. Remaining launch decisions

- Public product name/permission and domain.
- Trial duration, verified-account abuse controls, credit allowance/weights, discovery/storage caps, and founding-price terms.
- Evaluated production models/provider policies and acceptable latency/cost thresholds.
- Managed-auth email delivery configuration and tested sender domains.
- Data retention/deletion periods and customer-facing privacy/subprocessor disclosures.
- Recovery cadence, concurrency, lease length, retry policy, and measured cost of keeping the database active.

These are bounded decisions to resolve during the relevant milestones, not reasons to block local implementation of the agreed architecture.

## 16. Sources and verification notes

Official documentation checked September 30, 2026. Installed Neon skills still describe beta limitations; use current GA docs and validate APIs before implementation. No claims in this document imply a deployed JobSync Cloud service.

- [Neon GA announcement](https://neon.com/blog/neon-backend-is-ga)
- [Neon Functions overview](https://neon.com/docs/compute/functions/overview)
- [Function runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits)
- [Function Triggers](https://neon.com/docs/compute/functions/triggers/overview)
- [Object-created triggers](https://neon.com/docs/compute/functions/triggers/object-storage)
- [Managed Better Auth capabilities](https://neon.com/docs/auth/roadmap)
- [Neon Object Storage](https://neon.com/docs/storage/overview)
- [Neon pricing](https://neon.com/pricing)
- [OpenRouter key spending limits](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key)
- [OpenRouter provider data policies](https://openrouter.ai/docs/guides/privacy/provider-logging)
- [Motion for React installation](https://motion.dev/docs/react-installation)
- Repository evidence: `LICENSE`, `package.json`, and source paths listed above. No trademark clearance or model-provider contractual review has been completed.
