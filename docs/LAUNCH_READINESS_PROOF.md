# JobSync Cloud launch pass — 2026-10-01

Production: https://jobsync-cloud.vercel.app. This report ships with the release
commit; the final handoff records its exact SHA.

## Product delivered

- Original globals.css blue palette, outline borders, offset shadows and shadcn
  primitives now apply consistently to public pages, authentication, onboarding,
  workspace, account controls and policy pages. Dark mode uses the same tokens.
- Desktop sidebar and mobile navigation organize Home, Jobs, Discover and Resume.
  Settings, theme, sign-out and legal links remain accessible. Home prioritizes
  actual next actions, matches, confirmed-resume state, watches and allowances.
- Landing explains the real resume → company watches → application workflow.
  Pricing uses enforced trial/Plus limits: trial 2 resume runs, 5 job analyses,
  3 watches; Plus 5 runs, 60 analyses, 30 watches. Both allow 2 discovery scans/day;
  job analyses also have a 3-start UTC daily cap. No unlimited claims.
- Settings consolidates profile/timezone, three-state work arrangements and target
  preferences, plan/usage, billing, password recovery, other-session revocation,
  private export, original-file downloads and deliberate account deletion.
- Motion improves navigation, route changes and onboarding progression. Drafts
  survive step/tab changes. Reduced motion, keyboard controls and focus states
  are preserved. Mobile container sizing and serialized watch timeout were fixed.

## Account and privacy guarantees

Export returns a private no-store JSON snapshot of owned workspace content,
versions/source text, preferences, applications/history, matches, usage and plan
history. Original files use separately authenticated downloads. Auth secrets,
provider request identifiers and signed capability URLs are excluded from JSON.

Deletion requires the typed phrase and current-password reauthentication. A
non-cascading durable tombstone blocks resurrection and new work. Cleanup waits
for active leases and signed upload capabilities, expires Stripe checkouts,
cancels subscriptions, validates customer provenance/mode, removes the exact
owner storage prefix and private records, then removes the Managed Auth identity.
Provider failures retry through a leased five-minute recovery worker. Public ATS
boards/postings remain shared. Only minimal cleanup IDs and anonymous conservative
AI cost envelopes remain; provider/backups retention is described separately.

Private page reads sanitize unexpected errors before Next's default logging.
Request-error telemetry emits only generated error ID and route/runtime metadata.
Sensitive error/request canaries prove resumes, prompts, responses, emails,
credentials and signed URLs stay out of these events. Privacy/terms describe the
actual Neon, Vercel, OpenRouter and Stripe boundaries. Architecture documentation
identifies Vercel AI SDK and the official OpenRouter provider.

## Verification

- Complete existing and added suite: 174 tests; account coverage includes 3 real
  isolated-Postgres cases, 6 external adapter cases and 5 API boundary cases.
  Observability has 2 sensitive-data canary tests.
- TypeScript, Prisma schema validation, production build and diff checks pass.
  ESLint has no errors and two preexisting unused-import/image warnings.
- Production Playwright launch lifecycle passes (1/1): landing → signup/verification
  surface → real DOCX upload/validation → actual OpenRouter resume draft → review/
  confirmation → preferences/back navigation → Home → Figma watch → real scheduled
  matching → track application → Jobs → Home → Resume → Settings profile → usage/
  billing → JSON export/original download → durable account deletion.
- SMTP delivery is not proven: unique temporary accounts were verified by an
  explicit admin-only fixture scoped to their session ID AND generated email.
  Resume AI, Discover results/tracking, export, file download and deletion were
  actual deployed operations. The second user's private sentinel was a fixture
  solely for isolation assertions; it remained byte-for-byte unchanged.
- 390px mobile checks cover all five workspace routes without horizontal overflow;
  dark theme, reduced-motion preference and keyboard tab controls pass. T3 preview
  separately audits deployed desktop/mobile public and private screens and the
  typed/password deletion flow. Screenshots are local ignored QA artifacts.
- Production cleanup verifies all 9 temporary accounts (including audit and
  corrected fixture attempts): 9 completed cleanup requests, zero original files,
  private profiles/resumes/applications/work runs, Auth users and sessions. Founder/baseline accounts and all 275 captured public posting
  identities remain. Completed cleanup tombstones are intentionally retained.
- A fixture UUID error and a baseline mismatch from separately cleaning the T3
  audit account were corrected; the final production lifecycle rerun is green.
  Repeated concurrency coverage revealed the default 5s transaction deadline;
  discovery mutations now allow bounded 30s lock contention while retaining caps.

## Remaining activation gates

See [PRODUCTION_ACTIVATION.md](PRODUCTION_ACTIVATION.md) for precise configuration.
Production verification/recovery email delivery, production Google credentials,
private support/operator/legal review and coordinated credential rotation remain.
The pass did not invent missing credentials or rotate interdependent secrets.

Stripe remains test-mode; public live charging stays disabled. Live product,
price, secrets, webhook, Portal, web/worker configuration and end-to-end lifecycle
proof must all match before activation. No live charge was enabled by this pass.
