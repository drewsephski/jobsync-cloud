# Immediate shared-catalog discovery

## Product behavior

The completed-onboarding Find jobs action opens a populated Discover feed using
the confirmed resume and target role. Find jobs / Refresh matches also performs
a bounded deterministic pass directly from Discover. Company selection is optional:
Watch this company means ongoing monitoring of that employer's future openings.
The home and public product copy describe the same progression.

Cards appear with role/skill evidence before AI finishes. Their fixed minimum-height
review area later gains an AI score/rationale without reordering the feed. Saved,
dismissed and tracked state stays private and survives preference/resume changes,
posting updates and unwatching. Historical cards identify their earlier search;
stale AI scores, recommendations and rationales are hidden.

## Fast path

`planner.ts` contains no provider or network calls. It serializes on the owner
profile, reads only confirmed inputs and active entitlement, and considers all
open postings from enabled boards with a successful snapshot in the last 24 hours.
The 24-hour grace window preserves useful results through transient outages while
six-hour background refresh continues. Company watches do not restrict planning,
feed reads or AI eligibility.

An indexed title substring prefilter is a superset of the lexical ranker, including
title aliases. At most 3,000 title candidates are loaded per pass; location and
remote requirements plus confirmed skills/keywords determine eligibility/rank.
Generic product/software/data overlap cannot replace a different engineer,
designer or scientist occupation. `discovery-lexical-v2:match-lean-v1` versions
this behavior explicitly. Cursor continuation covers larger organic catalogs in
the background rather than letting unrelated postings consume the first page.

One batched match insert and bounded lookups replace the old per-card round trips.
At most 50 private immutable-input matches are materialized and three AI runs per
owner/UTC day are admitted. Completed planning checkpoints record the exact
catalog size, title candidates, eligible/surfaced/queued counts and elapsed time.
No public posting is copied per user. Exact owner/resume/preference/posting/prompt
provenance and the immutable database constraints remain unchanged.

Trial/Plus full scan limits remain two per UTC day, normally twelve hours apart.
Exact input changes can repair deterministic relevance immediately. Incremental
background catalog or company refresh does not spend another full-search scan;
the paid AI dispatch allowance is still checked independently under database locks.
Unchanged background input/catalog keys are skipped once cursor coverage completes.

## Shared catalog and durable work

`catalog.ts` defines exactly twelve service-warm provider/token pairs: Figma,
Spotify, Linear, Clover Health, GitLab, Cloudflare, Datadog, Duolingo, Reddit,
Airbnb, Notion and Stripe. They are independently refreshed every six hours even
without watchers. The 3,622-board directory is for deliberate company selection,
not a scraping schedule. Warm seeding has an explicit branch opt-in, a twelve-board
budget, no AI dispatch, and validates successful fresh snapshots before release.

Eligible user watches refresh additional shared boards on the same schedule.
Their fresh public postings can help every user's next search. After the last watch
ends, a non-warm board stops being refreshed; its snapshot remains reusable only
within the freshness window. Warm boards and watches share identical generation
keys, ingestion leases, complete-snapshot validation, failure/backoff and two-miss
closure. One shared fetch serves every interested user.

The app commits matches/watches before scheduling a `next/server` `after()` call
to the separate Neon Function's `/wake`. This authenticated server-to-server POST
does not hold the browser response. The Function claims Postgres work and awaits
the bounded invocation; the app request does not become a worker. Its secret is
server-only, compared in constant time, and never follows redirects. Wake payloads
are strict and bounded; session-derived owner identity is used by the app.

The Function checks board eligibility itself, deduplicates shared ingestion, and
immediately rematches up to ten watchers after a due board succeeds. It processes
the caller's already-queued AI matches in waves of two, only starting another wave
within twenty seconds of wake start. Pending work remains durable if wake/network
delivery fails or that budget expires. Recovery every five minutes repairs missed
wakes, rotates users fairly, advances catalog cursors and processes remaining AI.
Ingestion, planning and matching use bounded parallelism of two within the existing
five-global/two-owner lease limits. No additional queue service was introduced.

The original trigger-only `/recover` endpoint stays attested by Neon. The new
`/wake` uses a separate Bearer secret because Function URLs are public; `auth: true`
does not protect them. This follows [Neon Function authentication](https://neon.com/docs/compute/functions/authentication),
[trigger delivery](https://neon.com/docs/compute/functions/triggers/overview), and
[runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits).

## AI and release operations

AI SDK 7 and the official OpenRouter provider retain GPT-6 Luna, Azure-only ZDR,
data collection denial, no provider fallbacks, no SDK retries, durable reservations,
receipt settlement and existing trial/Plus units/cost ceilings. An uncertain paid
outcome is never automatically resent. AI failure preserves deterministic cards.
No AI Gateway, automatic applications or outreach was added.

Vercel needs `DISCOVERY_WORKER_URL` and `DISCOVERY_WAKE_SECRET`; the discovery
Function receives the same secret plus its existing OpenRouter credential/mode.
The additive migration indexes fresh board selection and open posting title search
with PostgreSQL `pg_trgm`. The resume/account workers and their schedules remain
unchanged. Visible pages poll at three seconds only during outstanding work, back
off after ninety seconds, pause when hidden and stop once work settles. Failed
board monitoring is shown honestly rather than causing indefinite fast polling.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:validate`, `pnpm build`,
and `git diff --check`. The isolated production browser proof is gated by
`JOBSYNC_DISCOVERY_FIRST_USE_PROOF=https://jobsync-cloud.vercel.app` and matching
`JOBSYNC_BROWSER_ORIGIN`; run `pnpm exec playwright test discovery.spec.ts`.
It uses real signup/upload/confirmation with synthetic documents, two private
accounts, actual provider receipts and shared monitoring, then removes its own
Auth/storage/private rows while retaining reusable public catalog data.

The baseline script intentionally refuses to measure the new deployment. Its old
production fixture used a seeded confirmed resume, not an upload: zero watches
produced zero cards, Find was unsupported, and watching fresh Figma took 80.958 s
to produce 26 cards. One baseline AI usage row was deleted before receipt details
were captured; its tokens/cost remain unknown. This is a comparative discovery
baseline, not an end-to-end onboarding claim.
