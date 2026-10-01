# Job discovery

## Product and ownership

`/dashboard/discover` is the first post-onboarding workflow: choose companies,
read relevant public openings, inspect the original posting, save or dismiss.
The page preserves the onboarding visual language without replacing the shell.
Search covers 3,622 upstream directory boards; verified Spotify is additionally
seeded intentionally. Directory availability is not a guarantee that every old
board remains active. Greenhouse, Lever global/EU and Ashby are supported.

Shared service-owned tables: `Company`, `AtsBoard`, `JobPosting`. A posting has
one unique `(boardId, externalId)` identity, normalized text, original HTTPS URL,
publication date when known, content hash/version, last-seen and closure state.
Private tables: `CompanyWatch`, immutable-input `JobMatch`, and `UserJobState`.
Actions survive recomputation and unwatching; historical saved/dismissed cards
hide stale AI scores. Ownership comes from the independently verified session,
never a request owner ID. There is no public-record mutation endpoint.

## Ingestion and scheduling

`discoveryworker` is a separate Node 24 Neon Function using the existing
Postgres `ProcessingRun` implementation. `discovery-recovery` wakes `/recover`
every five minutes, including when the app/browser is closed. Neon triggers are
wakeups, not a queue. Only enabled boards with watchers are intentionally queued.

An atomic conflict-safe insert converges simultaneous watchers on the same
service-owned run, keyed by board freshness generation. Due state/generation are
read together. Success transactionally upserts the whole normalized board and
advances six-hour freshness. Two consecutive complete successful snapshots must
miss a posting before it is soft-closed; rows/history are never deleted. Reopening
or changed normalized content increments its version. Failures retain results;
retry/backoff prevents a failing board from monopolizing the due prefix. After
exhausted attempts, a later freshness generation permits another bounded attempt.

Provider fetches have one 20-second deadline, 20 MiB cumulative response bound,
3,000-job ceiling, strict snapshot validation, fixed API hosts and no redirects.
Lever uses 100-row pages, region routing, and a repeated-page/truncation guard.
Ashby unlisted postings are excluded. HTML is decoded/stripped as text, never
rendered. Descriptions are bounded to 16,000 characters. Original posting links
may use safe employer-owned HTTPS career domains; they are never fetched by us.
Greenhouse uses `first_published`, Ashby `publishedAt`; Lever dates are unknown
rather than presenting undocumented creation timestamps as publication dates.

Recovery processes at most three ingestion runs, plans ten users in a fair order,
and executes two matching runs per invocation. Claims retain existing 5 global /
2 owner concurrency limits, 120-second leases, fencing tokens and cancellation.
No provider/network request is inside a transaction. A rotating private scan
cursor examines at most 3,000 postings per user/transaction, so large watchlists
eventually cover older openings. Resume/preference/watch changes reset scanning.

## Deterministic relevance and AI

`discovery-lexical-v1:match-lean-v1` normalizes title aliases and word boundaries,
requires substantive title overlap, applies a minimum relevance floor, and adds
bounded evidence from confirmed resume skills and preferred keywords. Location
and remote eligibility never inflate fit scores. Salary settings remain saved but
salary filtering is explicitly not yet supported. Unknown remote status cannot
satisfy a remote-only filter. Remote geography cannot always be established from
public boards; users should inspect the original posting's eligibility details.

At most 50 candidates per scan page are materialized; at most three new matching
runs/user/UTC day are queued. A second atomic dispatch-time daily cap protects
against old queued work crossing midnight. Deferred work is moved to the next UTC
day. Saved/dismissed views retain the most recent 100 action histories and show
up to 50 cards; new views show up to 50 strongest current results.

Every match binds owner, exact confirmed resume version (owner-qualified FK),
preference revision plus canonical hash, posting content version/hash, and
algorithm/prompt version into a unique fingerprint. PostgreSQL rejects changes
to this provenance. No unconfirmed latest draft, uploaded source text, contact
details or unrelated private profile is sent to matching. Before dispatch and
again before product commit, active inputs/watch/posting state are checked.
Changes during inference retain real billing but prevent stale product writes.

The official OpenRouter provider and AI SDK 7 use the existing centralized
`openai/gpt-6-luna` configuration: Azure only, mandatory ZDR, data collection deny,
required parameter support, no fallbacks or SDK retries. Matching has a strict
score/recommendation/short-rationale schema, 600 output tokens and a 30-second
deadline. Matching JSON is capped at 60,000 UTF-8 bytes before dispatch, with a
conservative 15,000 micro-USD reservation. Oversized canonical identity fields
reject the entire provider snapshot. Deterministic cards never display an invented AI score. A failed AI
attempt leaves the deterministic card useful.

Existing durable reservations/accounting are generalized by feature/config.
The `discovery` policy starts at 100 monthly units, $1 owner monthly / $5 global
daily ceiling; admissions include existing usage and unresolved holds. Each call
has a committed in-flight marker first; private match acceptance, usage and run
completion commit together. Duplicate runs cannot resend a paid/uncertain request.
Matching deliberately allows one provider attempt. Unknown costs remain unknown;
existing hourly resume recovery reconciles generation receipts for both features.
Disabling the discovery policy stops new reservations and dispatches immediately.
No Neon AI Gateway, automatic application or outreach is used.

## Live evidence

Isolated branch: `lively-shape-65452824/br-tiny-tree-b44fo1lv` (the existing app
branch named `production`; endpoint and isolation were explicitly verified).
Reusable directory/public data are intentionally retained. `pnpm discovery:live-proof`
requires `JOBSYNC_DISCOVERY_LIVE_BRANCH` to equal that exact project/branch.

Successful proof at 2026-10-01 05:01–05:02 UTC:

| Board | Shared open postings | Fetches per board for two watchers | End-to-end ingestion |
| --- | ---: | ---: | ---: |
| Figma / Greenhouse | 164 | 1 | 2.211 s |
| Spotify / Lever | 80 | 1 | 2.123 s |
| Linear / Ashby | 30 | 1 | 1.231 s |

The public rows already seeded by earlier adapter/proof checks remained exactly
274 rows, with no per-user duplication. Twenty simultaneous ensure requests per
board converged on one run. Engineer preferences: 274 → 39 eligible → 39 surfaced;
designer: 274 → 22 eligible → 22 surfaced. Three AI candidates/user were queued;
this proof deliberately canceled four and dispatched only one per user.

| Matching | Input tokens | Output tokens | Provider latency | Actual OpenRouter USD |
| --- | ---: | ---: | ---: | ---: |
| Designer | 1,511 | 179 | 3.342 s | 0.0001038312 |
| Engineer | 1,682 | 184 | 3.580 s | 0.00029915325 |
| Total | 3,193 | 363 | | **0.00040298445** |

The integer ledger conservatively rounded this to 404 micro-USD. Worker latency
including database admission/commit was 6.440 / 6.883 seconds; total proof 60.463
seconds, including sixty concurrent board ensure requests. Exact confirmed input
was asserted, a newer unconfirmed draft was excluded, private save/dismiss were
independent, preference changes produced new immutable matches, and all replayed
matching operations were no-ops with two usage rows/two reservations.

Development limitations: two earlier proof attempts ended with uncertain,
unreceipted outcomes and were never automatically resent. Their exact billing
cannot be asserted from available receipts; the total above is the successful
proof only, not a claim about all development spend. Two additional small direct
adapter diagnostic calls returned receipts totaling $0.00021384. Temporary proof
private rows were removed as requested. Final successful sanitized evidence is
in ignored `output/discovery-live-proof.json`; no resume payload or secret is
committed. Provider outages/uncertainty intentionally preserve deterministic cards.

Production browser/schedule evidence and final release checks are recorded below.

### Deployed browser and scheduled recovery

Two isolated managed-auth users watched the same Figma board through production
Discover. Their deliberately synthetic confirmed profiles targeted software
engineering and product design; resumes were seeded to focus this proof on
discovery, while the existing production onboarding browser fixture was tested
separately. The scheduler produced 23 and 13 independent private matches from
164 Figma postings with no browser on Discover and no manual worker invocation.
The already-fresh shared board's generation/fetch count and last-success timestamp
remained unchanged. Scheduled Neon invocations at 05:16, 05:17 and 05:18 UTC were
observed in function logs. The trigger was temporarily accelerated to one minute
for this isolated proof, then restored to the deployed five-minute cadence.

Six bounded AI dispatches (three/user) produced five successful Azure/Luna
receipts: 7,833 input tokens, 1,137 output tokens, 2.253–3.341 s provider latency,
**$0.0015317775 actual OpenRouter cost** (1,534 micro-USD rounded ledger).
One dispatch ended `provider_outcome_unknown` without a generation ID or receipt;
its billing remains unknown and it was never automatically retried. Thus this
figure is known receipted cost, not a complete six-call cost claim.

Production DOM/interaction checks verified company search/watch, distinct feeds,
actual AI scores alongside deterministic-only cards, safe HTTPS original links,
save/dismiss/restore controls and filters, preference editing, and no horizontal
overflow at 390×844. The engineer could not mutate a designer-only posting (404)
and saw zero designer saved/dismissed actions. A preference revision preserved a
saved card but hid its stale AI score/rationale before scheduled recomputation.
The collaborative preview snapshot service could not resolve its attached client;
DOM and layout checks were completed, but a screenshot visual review is not claimed.

Both temporary managed-auth accounts and all their private profile/resume/watch/
match/state/run/usage/reservation rows were removed after evidence capture. The
preexisting founder profile was preserved. Only the intentionally reusable 274
public postings, company directory/boards, and shared service ingestion history
remain. Unknown proof costs are recorded in the sanitized evidence before the
requested fixture-ledger cleanup. No private resume payload or secret is committed.

### Release validation

`pnpm test` runs the complete existing suite plus discovery API/provider/real
Postgres integration tests (137 total after two final bounds tests). Coverage
includes concurrent ensure/claim, missing snapshots and closure, stale leases,
immutable match provenance, confirmed-only inference, input changes during a
paid request, replay/charges, daily caps across midnight, a 3,000-row rotating
scan, historical saved state after unwatch, provider failures and tenant isolation.
The existing production onboarding browser fixture passed separately. Lint,
typecheck, Prisma validation, production build and `git diff --check` passed;
lint retains two preexisting UI warnings. Two schema migrations and the separate
Neon discovery function were deployed, with the existing resume recovery retained.
The app is served at https://jobsync-cloud.vercel.app/dashboard/discover.
