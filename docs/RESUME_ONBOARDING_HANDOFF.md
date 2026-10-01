# Resume onboarding

## Product contract

`/onboarding` reads server state on every visit: upload → durable processing →
review/correct → explicit confirmation → target preferences → dashboard.
Incomplete users visiting dashboard routes return to onboarding. Completed users
are never forced through setup again; `/dashboard/resume` opens the shared editor.
No localStorage determines completion or consent.

Contact, summary, skills, employment, education and credentials are editable.
The original file, original AI draft, evidence passages and extraction provenance
remain available for comparison. Empty sections and missing name show guidance.
Confirmation requires a name and meaningful resume content, saved edits, and an
explicit acknowledgment/action. Viewing or saving never implies acceptance.

The preferences step accepts 1–10 distinct titles and optional shared locations,
remote preference, minimum annual USD salary, and keywords. Every title becomes
a separate `TargetPreference`. Save for later persists across devices; finish
atomically persists preferences and `onboardingCompletedAt`.

## Schema and concurrency

Migration `20261001020000_resume_confirmation` adds:

- `Resume.confirmedVersionId` / `confirmedAt`: paired explicit consent, with an
  owner-and-resume-qualified foreign key.
- `ResumeVersion.originDraftId`: owner-and-resume-qualified immutable AI lineage.
- `UserProfile.preferenceRevision`: nonnegative optimistic concurrency token.

AI versions remain drafts. A confirmed pointer is the acceptance boundary; future
matching/profile consumers must read it rather than treating the newest draft or
an uploaded file as accepted facts. Editing creates a new manual JSON snapshot
without copying AI evidence into user-authored content. The earlier confirmation
remains intact until the newer version is explicitly reconfirmed.

Mutations derive ownership only from the verified server session. Strict request
schemas reject owner IDs. They acquire an owner profile `FOR NO KEY UPDATE` lock
then an owner-qualified resume lock shared with worker version allocation.
The weaker profile lock still serializes user mutations while allowing worker
foreign-key `KEY SHARE` checks, avoiding an inverted-lock deadlock.

Every save/confirm/preferences mutation checks `expectedVersionId` against the
latest upload's lineage. A stale browser receives 409 and retains its edits until
the user explicitly discards/reloads. Preference writes also check their revision.
Snapshot reads use repeatable-read transactions. Versions allocate from the
global maximum for the resume under its row lock. Older uploads finishing late
cannot replace the newest upload's active review lineage. Duplicate confirmations
and completed finish requests preserve the original timestamps.

Database transaction acquisition waits at most 10 seconds for pool contention;
the existing execution deadline remains unchanged.

## Parsing and upload recovery

DOCX text uses pinned Mammoth 1.13.0 `extractRawText` with an in-memory Buffer;
PDF uses existing unpdf 1.8.1 / PDF.js. Both run in constrained worker threads
without inherited provider credentials, with a terminable 15-second deadline,
128 MiB old-generation limit, 40,000-character cap, and source SHA-256 check.
Full ZIP preflight precedes Mammoth: paths, entry counts, inflated bounds,
encryption, CRC and package XML are checked. Mammoth's external file access is
disabled by default; no HTML rendering or OCR is added.

Library references: [Mammoth API/security](https://github.com/mwilliamson/mammoth.js)
and [unpdf](https://github.com/unjs/unpdf). Parsing stays in the existing Neon
Node worker rather than adding a long-running Next request or another AI call.

Production upload failure was an S3 CORS configuration omission: only localhost
was allowed. `storage:configure` now accepts exact `APP_ORIGIN` plus optional
comma-separated `STORAGE_ALLOWED_ORIGINS`; production and localhost are configured
explicitly without wildcard access. Direct signed PUT avoids proxying a 5 MiB
file through a Vercel request body. Upload network errors distinguish storage from
the app API and have bounded timeouts. Terminal extraction failures retain the
uploaded file and state, with source download and replacement-upload recovery.
Ambiguous paid AI outcomes retain the existing no-automatic-retry policy.

## Verification and deployment

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:validate`, and `pnpm build`.
`pnpm onboarding:browser:test` exercises real managed-auth signup with an isolated
seeded draft and no provider invocation. `pnpm onboarding:live-proof` requires
`JOBSYNC_ONBOARDING_LIVE_BRANCH=lively-shape-65452824/br-tiny-tree-b44fo1lv`;
set `JOBSYNC_BROWSER_ORIGIN=https://jobsync-cloud.vercel.app` for production proof.
Browser tests assert the isolated database endpoint before creating records.

Tests cover ownership, immutable history, stale edits, repeat confirmation,
preference revisions, multiple roles, resumption, timestamps, late completion,
worker/user lock compatibility, strict API payloads, mobile overflow, keyboard
tabs/confirmation, route guards, and unchanged provider accounting after review.
Browser cleanup removes only tracked temporary users' private objects, application
rows and managed-auth identities, then verifies preexisting profiles remain.

The schema is applied to the existing isolated Neon branch. Deploy the Function
with `neon deploy --env .env.local --no-env-pull` and the app with `vercel --prod`.
The web deployment does not receive the worker's OpenRouter API key.

### Completed proof (2026-10-01 UTC)

- Full suite: 120/120 server tests passed; lint has zero errors and two unchanged
  primitive warnings. TypeScript, schema validation, migration status (none pending),
  local build and Vercel build passed.
- Fixture browser: passed locally and against production, including version conflicts, preservation of preferences
  when returning to resume review, mobile width 390, keyboard operation, refresh,
  completion and direct routes; zero provider calls.
- Production browser at `https://jobsync-cloud.vercel.app`: complete real signup →
  signed DOCX upload → Mammoth/background AI draft → edit two snapshots → confirm →
  save two roles → refresh → finish → dashboard. Confirmed at
  `2026-10-01T01:11:13.093Z`; completed at `2026-10-01T01:11:17.801Z`.
  One extraction usage record; zero additional provider invocations during review,
  confirmation or preferences. A second isolated user received 404 for private
  upload/download/version mutations and saw no first-user preferences.
- Both browser proof accounts, their objects and application rows were deleted,
  and managed-auth deletion succeeded. Earlier interrupted test records were
  separately removed by exact IDs. The founder account/profile was preserved.
- Neon worker deployment 12 is active on Node 24 with the new parser; storage CORS
  permits exact localhost and production origins. Production managed-auth origin
  and app environment are configured. The imported provider key was removed from
  Vercel; it remains in the worker environment.

Screenshots and traces are local ignored artifacts in `output/playwright/`.
