# Resume upload investigation — 2026-10-01

The recent Vercel request logs include POST `/api/resume-uploads` returning
403. The account owning the three older expired upload records has no
`emailVerifiedAt`, `trialStartedAt`, or `trialEndsAt`. Upload admission requires
verified email and an active entitlement. Verification must happen through the
existing auth flow; upload recovery does not bypass that requirement.

The earlier CORS omission is documented in `RESUME_ONBOARDING_HANDOFF.md`.
Current bucket rules allow localhost and the production application explicitly.
Live OPTIONS requests for both origins returned 200 and allowed PUT with
`content-type,if-none-match`. The latest synthetic DOCX upload was observed
succeeding in both the database and Neon Function logs: validation took 127 ms
and structuring took 5,312 ms. This is evidence of the existing live pipeline,
not a deployment of the changes below.

## Recovery changes

- Keep API error codes so verification, account deletion, plan restrictions, and
  incorrect origin get specific messages. Stop polling terminal HTTP errors.
- Reconcile ambiguous PUT failures using the owner-protected completion API.
  Retry transient transfers at most three times against the same signed,
  create-only object key. Never overwrite on 412 or create duplicate intents
  during automatic retries. AI retries and budgets are unchanged.
- Infer a PDF/DOCX declaration only when browser MIME metadata is missing or
  generic. Actual file validation remains in the worker.
- Explain expired uploads accurately and avoid claiming file receipt when only
  the upload record is known to exist.
- Log handled API failures with a generated event ID, safe error code and
  status. No request body, file content, credentials, signed URL, or raw error
  is logged.
- Share CORS configuration and smoke validation. Accept multiple exact origins,
  trim and deduplicate configured origins, and check required methods, signed
  headers, and ETag exposure. Reject wildcard origins.

## Verification

Regression tests cover lost responses, bounded retries, create-only conflicts,
terminal API restrictions, missing MIME metadata, expired upload messaging,
sanitized logging, and missing production origins or required CORS headers.
Type checking, lint, production build, storage tests, and read-only storage smoke
checks are run for the change. Lint retains the existing image-card warning.

Vercel connector log queries timed out even after narrowing the window; Vercel
CLI request logs supplied the request/status evidence. Neon Function logs and
database metadata supplied the processing evidence. No real resume contents
were downloaded or changed during investigation.
