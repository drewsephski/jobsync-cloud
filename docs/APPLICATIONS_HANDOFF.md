# Application tracking

## Product and research

The hosted loop is Discover → Track application → record Applied → record hiring
movement → choose the next action from the dashboard. Jobs found elsewhere use
the same application tracker. There are no new AI calls, automatic applications,
external submissions, or outreach.

Research checked cloud main `056aa7662b8a832d67d6067af0bfd94df493c28c` and latest
upstream `Gsync/jobsync` at `ef3d7eec5c9aebaa1c6e03fc3ddd62d7dca8e37f`.
Upstream’s [stage schema](https://github.com/Gsync/jobsync/blob/ef3d7eec5c9aebaa1c6e03fc3ddd62d7dca8e37f/prisma/schema.prisma)
and [stage promotion helpers](https://github.com/Gsync/jobsync/blob/ef3d7eec5c9aebaa1c6e03fc3ddd62d7dca8e37f/src/actions/jobStage/shared.ts)
provided useful concepts: create the initial history entry atomically, qualify
ownership through the aggregate, and synchronize current status with movement
in one transaction. The cloud implementation omits user-defined stage libraries,
editable timeline events, contacts, tasks, interview preparation and other CRM
features. It uses six statuses with optional human-readable stage labels and
append-only history.

## Schema and integrity

Migration `20261001090000_applications` adds private `Application` and
`ApplicationEvent` records, separate from shared `JobPosting`, private immutable
match provenance, and Discover saved/dismissed state.

An application captures editable company/title/location/URL, salary, notes,
application date, follow-up date, next action, status, stage label, and optionally
a confirmed resume version. A separate immutable JSON snapshot preserves the
original posting text/identity/hash/version and exact selected private match
provenance. The discovered resume is matching context, not a claim that it was
submitted. Recording a resume used is an explicit user choice, restricted to an
owned, ready, currently confirmed version. Its name/version/confirmation metadata
is captured; a later confirmation does not invalidate an existing association.

The optional posting FK uses `ON DELETE SET NULL`. Its captured source key and
snapshot remain intact if the public posting is edited, closed or removed.
There is no customer write endpoint for public catalog data. Database triggers
reject source-identity changes and history updates. History’s owner-qualified
composite FK prevents cross-user attachment. Deleting an application removes
its private events; public posting/match/save state is unaffected.

Statuses: Saved / Preparing, Applied, Interview, Offer, Rejected, Withdrawn.
Interview rounds can be recorded by stage label, including multiple stages
under Interview. Each meaningful movement gets status before/after, stage,
occurrence date, note, revision and server recording time. Backdating changes
occurrence dates, not the order of recorded transitions or current-state authority.
History is explicitly shown latest-recorded-first. Actual application and movement
dates cannot be future dates; follow-up dates can. Calendar dates are SQL DATE
and round-trip without timezone shifts. Defaults/due checks use the profile’s
IANA timezone, or UTC when unset.

## Ownership, retries and concurrency

Every page authorizes independently and redirects incomplete onboarding. Every
API request resolves a verified session, rejects foreign origins, sets no-store,
bounds JSON, and validates a strict discriminated union. No owner IDs are accepted.
Missing and foreign applications return the same 404. The domain is deterministic
and does not import a provider or worker.

All mutations lock the verified owner’s profile with `FOR NO KEY UPDATE`, following
the existing onboarding/discovery lock order. This serializes simultaneous
Discover conversion and resume confirmation. Database unique keys enforce one
application per owner/captured posting and one per owner/manual creation key.
Repeated conversion returns the existing ID without altering status/history or
reviving an archived application. Manual forms retain their creation key for
network retries. A permanently deleted application can be tracked afresh.

Edits, movements, archive/restore and deletion require an expected revision.
The row update is also qualified by owner and revision; status update and new
event commit together. Stale edits return 409, preserve the browser draft, and
require explicit discard/load-latest. No history is written on a rejected update.
No-op movements without notes and repeated archive state changes add no history.

Archive is reversible and retains history. Permanent deletion is offered only
for archived applications, with an explicit confirmation. The server independently
enforces archive-before-delete and revision checks.

## Product surface

`/dashboard/jobs` offers active/all/status/archived views, company/title/stage
search, manual entry and focused application detail. Detail separates editing
from movement recording and shows history, captured match context and posting
availability. Original links open safely in a new tab. Discover cards retain their
independent save/dismiss behavior and gain Track application / View application.
The existing shell is retained.

`/dashboard` displays actual active/applied/interview/offer counts. Next actions
prioritize due/overdue follow-ups, saved applications, upcoming follow-ups and
active applications needing a chosen next step. Recent movement comes from real
private events. Current untracked Discover results link into discovery; empty
states suggest useful first actions rather than inventing activity.

## Verification and deployment

Commands:

```bash
pnpm db:validate
pnpm db:deploy
pnpm applications:test
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm applications:browser:test
JOBSYNC_BROWSER_ORIGIN=https://jobsync-cloud.vercel.app pnpm applications:browser:test
JOBSYNC_BROWSER_ORIGIN=https://jobsync-cloud.vercel.app pnpm onboarding:browser:test
```

Migration `20261001090000_applications` and the app were deployed to the verified
existing app branch and https://jobsync-cloud.vercel.app. No worker/provider
configuration changed.
Browser proofs seed only tagged synthetic private fixtures against existing
intentional shared ATS rows. They do not require new matching or AI dispatches.
Cleanup removes only fixture-owned private records and managed-auth accounts,
then verifies the founder and shared public rows remain.


### Production evidence, 2026-10-01

The complete application browser test passed against the production alias in
26.8 seconds (32.2 seconds including setup/cleanup). A temporary managed-auth
account used a synthetic confirmed resume and a deterministic private saved
Discover match against an existing open Spotify posting. The fixture deliberately
had no company watch, so proof did not initiate matching or ingestion.

The browser tracked that Discover card, repeated conversion concurrently with
four authenticated API requests, and verified one application. Keyboard controls
recorded Applied and then Interview / Technical interview, with three durable
history events and an application date. Refreshing and revisiting preserved both
status and stage. A stale second tab kept local edits after 409 and explicitly
loaded the latest details.

A manually entered Product Engineer application coexisted with the discovered
application. Its follow-up date and next action appeared on the dashboard with
exactly two active applications, one interview and one due follow-up. Desktop
and 390×844 mobile screenshots were inspected. Manual archive, restore and
confirmed permanent deletion worked; deleting it left the discovered application
intact. Posting links retained safe original destinations.

A separate managed-auth fixture saw an empty application list. Attempts to edit,
archive, delete or track the first user's application/match returned 404 through
the actual deployed APIs. The first user's Interview state remained intact.
Neither fixture had AI usage or reservations. Both accounts and all their private
application/event/state/match/resume/preference/profile records were removed.
The baseline founder profile and intentional public posting were unchanged.

An additional collaborative-preview smoke created an isolated account, surfaced
an existing Figma posting and tracked it, then the desktop automation connection
interrupted. This is supplemental partial evidence, not the full lifecycle proof.
Its account and private records were removed separately, with exact equality of
the founder profile identity/creation time and all 274 public posting IDs, hashes
and open states before/after. The complete lifecycle above is proved by the
production browser test.

The existing production onboarding fixture also passed (19.8-second browser flow,
24.2 seconds including setup/cleanup): durable resume review, stale tabs, keyboard,
mobile, three confirmed/corrected versions, two target roles and dashboard
revisits. Its temporary account/storage/private rows were removed and founder
preservation was asserted. No new provider calls occurred after fixture review.

Evidence files are ignored under `output/playwright/`: application detail,
dashboard desktop and mobile screenshots, test results and failure traces from
development. The supplemental preview cleanup evidence is ignored in
`output/application-preview-proof.json`. No credentials or resume payloads are
committed.

### Release checks

Prisma validation, lint, typecheck, production build and `git diff --check` passed.
Lint retains the two preexisting UI warnings. The full `pnpm test` suite passed
143/143 tests: 137 existing tests plus six application tests. Application coverage includes real
Postgres ten-way conversion, concurrent edit/movement, owned confirmed-only
resume associations, retained previously submitted versions after reconfirmation,
manual retries, SQL snapshot/event immutability and owner FKs, source closure/
change/deletion, history, archive/restore/delete/retrack, future dates, timezone
calendar dates and real dashboard counts/actions. Browser tests add actual
session isolation, keyboard/mobile behavior and both product paths.
