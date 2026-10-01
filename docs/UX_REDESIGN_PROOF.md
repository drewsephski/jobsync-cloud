# JobSync Cloud UX redesign — 2026-10-01

Production: https://jobsync-cloud.vercel.app

## Product changes

- Resume-first Home with upload/review, discovery, and application next actions that evolve with the user's state. Urgent follow-ups lead without hiding upcoming interviews.
- Two focused resume steps, followed by a lightweight search direction handoff. Existing confirmed employment can suggest an editable target title; optional targeting controls are disclosed on demand.
- Calm shared surfaces, controls, dialogs, tabs, and neutral light/dark tokens. Selected tabs use a distinct darker surface in both themes.
- Four-destination mobile dock, safe-area content clearance, persistent measured active surface, and translation-only motion. Settings remains outside the primary dock.
- Landing and pricing tell the resume → discover → track story, with accessible FAQ accordions, shared brand, factual usage limits, and honest live billing availability.
- Discover introduces company watches in context, explains deterministic relevance separately from AI analysis, and refreshes visible watched results without exposing worker terminology.
- Settings uses contained tabs and compact usage rows. Account deletion remains explicit and password-confirmed.
- Includes the concurrent animated-icon, brand, and bounded upload transport recovery work requested for the final commit. Upload retries use the same create-only key and reconcile ambiguous responses; AI retries and entitlements are unchanged.

## Validation

- `pnpm test`: 180 service tests passed, zero failures.
- `pnpm typecheck`, `pnpm build`, and `git diff --check`: passed.
- `pnpm lint`: zero errors; the existing unused image-card native-image warning remains.
- All eight production browser checks passed (the application lifecycle check was rerun after fixing Home priorities). They cover public pages and FAQ keyboard interaction, animated icons and reduced motion, application history and conflict recovery, resume version/confirmation safety, navigation history/refresh/resize, and the real AI/discovery workflow.
- Forty rendered app captures cover Home, Jobs, Discover, Resume, and Settings at 320, 390, 768, and 1280 CSS pixels in both themes. Public pages also cover 1440px. Assertions check horizontal overflow and measured dock alignment. Screenshots were visually reviewed and iterated.
- Live workflow verifies signup → upload → AI draft → explicit confirmation → Discover → track → Jobs → Home → Settings → export/original download → durable deletion. Owner-private records and original files are removed; other profiles and shared public postings are preserved.
- Email activation in automated journeys uses an explicit administrative fixture scoped to both newly created identity and unique test email. This proves the verification UI boundary, not inbox delivery.

Browser artifacts remain ignored under `output/playwright/`; visual review crops remain ignored under `.impeccable/review/`. `DESIGN.md` and `.impeccable/design.json` document the actual shared system.

## Deliberate limits

Discovery still needs a company watch and at least one target role because those are existing discovery inputs. Company selection is contextual, but this pass does not add a universal job-board search or alter matching algorithms. Background scans can take several minutes; refresh/polling and saved progress keep the user oriented. Manual application entry and the full resume editor retain their detailed optional fields. Live Plus charging remains disabled by the existing rollout gate; this redesign does not enable it or change billing semantics.
