# Resume validation pipeline handoff — 2026-09-30

The commit containing this document implements private-upload deterministic validation. No AI call, OCR, text persistence, ResumeVersion, billing, or external queue was introduced. Neon Functions and triggers provide wake-ups; Postgres owns durable execution.

## Implementation

- Migration: `20260930190000_resume_validation`, applied to the verified isolated branch `br-tiny-tree-b44fo1lv` in project `lively-shape-65452824`. Existing upload CHECK constraints remain intact. Adds `ResumeDetectedFormat` (`pdf`, `docx`), nullable `validationCompletedAt`, `detectedFormat`, `contentSha256`, terminal/hash/metadata CHECK constraints, and a recovery index.
- Added pinned dependencies: `unpdf@1.8.1`, `fast-xml-parser@5.11.2`.
- Pure Node database/storage factories live in `lib/backend`; shared upload reconciliation and processing live in `lib/domain`. Existing Next adapters retain `server-only`. Function imports require neither Next/React runtime conditions nor web authentication/origin configuration. Its environment uses only the Neon-injected database and AWS storage values.
- Function slug: `resumeworker`; POST `/object-created` and `/recover`. `unpdf` is deployed as an external package so the bounded parser thread can import it.
- Object trigger: `resume-upload-created`, `storage_object_created`, private `jobsync-files`, prefix `users/`, path `/object-created`, enabled.
- Recovery trigger: `resume-recovery`, path `/recover`, final cron **`17 * * * *` UTC**, enabled. Hourly recovery is provisional; measure event loss, latency, Function cost and database wake cost before choosing a launch cadence. Recovery bounds each phase to five records/runs.
- Trigger authentication: required `X-Neon-Trigger-Invocation-Id`, version-1 validated envelope, matching body invocation ID and route-specific trigger type. Deployed edge stripping of forged client headers was verified. The object key is only a database lookup hint; unknown keys return a safe ignored result. Ownership/type/size come from the persisted upload row.
- Canonical run kind: `resume_validate_v1`. Idempotency key: `user:{ownerUserId}:resume-validate:v1:{uploadId}`. Atomic conflict-safe creation returns one logical run.
- Claims use a short transaction, `FOR UPDATE SKIP LOCKED`, and a short advisory-lock phase for atomic global/per-owner concurrency budgets (5/2). Each claim increments attempt and creates a fresh UUID token. Lease: **120 seconds**. No storage or parser work runs inside the transaction.
- Completion, failure, checkpoint, renewal, cancellation and retry require the current run ID/token, running status and unexpired lease. Terminal upload metadata and run completion commit together. A losing worker cannot overwrite a reclaimed run.
- Retry: sanitized `dependency_unavailable`; exponential base `30 × 2^(attempt−1)` seconds, base capped at 900 seconds, jitter multiplier 0.75–1.25, maximum **5 attempts**. Infrastructure exhaustion fails the run; content failures reject the upload permanently. Cancellation is checked between major units and honored in terminal writes.
- Download: exact stored key/bucket, bounded range and stream accumulation (5 MiB plus sentinel), 20-second abort, exact persisted size verification. No file bytes or raw dependency errors are logged.
- Successful validation leaves transport status `uploaded` and records actual detected format, completion timestamp and lowercase 64-character Node SHA-256 hex. Rejection records a stable code/completion timestamp, keeps hash/format null, fails the run and best-effort deletes the object. Rejected downloads are inaccessible.
- PDF: actual `%PDF-` signature, declaration agreement, real `unpdf`/PDF.js parsing of page operators, encrypted/password-protected rejection (including empty-password encryption), corrupt-file rejection, no OCR/text persistence. Terminable isolated parser thread: 15 seconds, bounded memory, maximum 100 pages.
- DOCX: classic ZIP signatures, EOCD, central/local directory bounds, entry count, sizes, flags, CRC, overlap, descriptors and path checks. Rejects encrypted, malformed, unsupported/Zip64/multi-disk archives. Preflight caps: **1,000 entries**, **100 MiB claimed uncompressed bytes** before inflation; XML markers capped at 1 MiB each. Bounded inflation verifies actual size/CRC. Requires valid content types, package relationship and Word document XML; generic ZIPs are rejected. No filesystem extraction.
- Owner-protected GET `/api/resume-uploads/{id}` exposes only safe status/validation information. Foreign and missing IDs are equivalent 404. Browser polling stops after approximately 45 seconds or on unmount. Background work remains independent; revisiting reads durable status.

## Live evidence on the isolated branch

All files below were deliberately tiny sanitized fixtures. IDs are correlation evidence, not retained database records.

| Proof | Observed result |
| --- | --- |
| Valid PDF through signed-in browser | Upload `4edf40ad-bfc2-4b66-9de8-d9c7aa9bd814`, run `c2f36c11-6695-4293-be40-081b9bd71ab9`; actual object trigger at 22:49:41 UTC, attempt 1 succeeded, 158 ms. Persisted PDF format, completion and SHA-256. Browser navigated away immediately after PUT; later status and revisited UI showed validated. |
| Invalid PDF through browser | Upload `4162d49d-af44-4612-8b5e-2a217c26d538`, run `8cb10f89-3ce4-4ff2-bce4-183c7b4ace70`; actual object trigger at 22:51:04 UTC. Permanent `invalid_pdf`, rejected upload, terminal validation timestamp, no hash, object removed, download 404 and safe UI message. |
| Valid DOCX through browser, final stable deployment | Upload `61da1c5e-31fd-4a36-a00a-494fd225f604`, run `a58eca52-982c-4b77-b091-c80c6f32fbbf`; actual object trigger at 23:06:39 UTC, attempt 1 succeeded, 72 ms. DOCX format, hash and completion persisted; UI validated. |
| Actual scheduled recovery | Temporarily deployed `* * * * *` on the isolated branch. Actual schedule invocation `RMKScq0rqtd4e5jQB3BqwsaOzFJvPy5uApf8lnfOHK4` at 22:53:01 UTC reclaimed fixture run `311df2e2-979b-4748-b8dd-0408a7e1f0b0`, assigned a different token, incremented attempt to 2, completed successfully. Completion with preserved old token was rejected. Restored and redeployed `17 * * * *`; final trigger listing confirmed hourly. |
| Duplicate event | Documented local envelope replay plus actual automatic object delivery produced one logical run per fixture. |
| Concurrent claims | Real Postgres tests: 20 simultaneous ensure/claim attempts, one logical run and one lease owner; separate tests verify global/per-owner budgets. |
| Trigger attestation | Deployed ordinary direct request and forged client `X-Neon-*` header both returned 403. |
| Runtime/bundle | `neon dev` replay verified schemas, DB/storage connectivity, unknown-key ignore, duplicate delivery and missing-header rejection. Function bundles/deploys independently of Next/React conditions. Final replay passed with the existing isolated-branch environment supplied explicitly after automatic CLI environment retrieval encountered an expired credential. |

An intermediate deployment captured a missing DOCX import and caused transient fixture retries. It was corrected, redeployed, and fresh live DOCX/local proofs passed. The final deployed source includes the correction. The temporary every-minute deployment and subsequent hourly restoration were both completed; no every-minute trigger remains.

## Checks and cleanup

Passed: frozen-lockfile install; Prisma validation/generation; DB smoke and 9 DB tests; 8 auth tests; storage smoke and 29 storage tests; 12 worker tests; 10 validation tests; TypeScript; production Next build; Function bundling/deployment; local Function replay; migration SQL inspection; credential and browser-bundle scans; `git diff --check`.

Lint passes with two unchanged baseline warnings in `components/ui/badge.tsx` and `components/ui/image-card.tsx`; no new warnings. No tests were skipped. Encrypted PDF fixtures are tiny blank sanitized documents; DOCX oversized claims are metadata-only tests, not generated decompression bombs. Recovery integration tests constrain their injected infrastructure to their own temporary fixtures, while executing durable SQL against real Postgres.

Final `neon config plan` reports only `~ function resumeworker` (the CLI's source-bundle refresh); no Auth, bucket or trigger changes. The Function and both enabled triggers were verified with CLI listings. README documents local `neon dev`, replay envelopes and `neon logs query --source function --since 30m --limit 100`.

All temporary fixture objects and application rows were removed. At the user's explicit request, the temporary proof auth account and **all seven of its files, including the manually uploaded real resume**, were deleted. Founder records were preserved. Final counts: one founder profile, zero resumes, uploads, processing runs and stored objects. No secrets, `.env.local`, `.neon`, generated Prisma client, signed URLs, real resumes, downloaded customer content or log/test dumps are included in the commit.
