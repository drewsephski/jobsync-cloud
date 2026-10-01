# Resume upload → structured draft — 2026-09-30

Implemented from main `efb915ecbf7bc37bfe018f3f5835b47fe4000887`. The existing private-upload/validation flow now produces a strictly validated, source-grounded **draft**. No acceptance/finalization, subscription UI, Stripe, OCR, matching, scoring, cover letters, provider selection or shell redesign was added.

## Architecture and provenance

- The existing `resume_validate_v1` run remains deterministic validation only. A subsequent `resume_structure_v1` uses `user:{owner}:resume-structure:v1:{uploadId}`. Object delivery chains it immediately; scheduled recovery discovers validated uploads missing their structuring run, so a crash between stages loses no durable work. Browser polling is observational, with a 90-second bound; reopening reads the durable draft.
- Reuses `ProcessingRun` claims, fresh lease tokens, 120-second leases, 5 global/2 owner concurrency limits and cancellation. DB transactions never span downloads, parsing or network calls. Renewals bracket allowance reservation before dispatch. In-flight work has a committed usage marker before any provider call. Duplicate or reclaimed workers cannot send a second call after uncertain/paid usage.
- Local text extraction downloads the exact immutable source, checks SHA-256 against persisted validation, and rejects rather than silently truncating excessive/empty text. PDF uses unpdf/PDF.js, at most 100 pages, a terminable 15-second/256 MiB thread and 40,000 characters. DOCX reuses ZIP integrity/preflight (1,000 entries, 100 MiB total expansion) and expands only the three required XML markers for extraction; marker size is now checked **before inflation**, at most 1 MiB each. An isolated 15-second/128 MiB thread traverses Word text in document order, preserving paragraphs/tables/entities and excluding deleted text/field instructions. Headers/footers, comments and OCR are not imported. Limits and fixtures are deterministic; full source text remains transient.
- Strict Zod schema includes contact, verbatim summary/skills, employment, education and credentials. Every fact must occur in extracted source; each entry's evidence must be a contiguous source passage containing its fields. Unknown fields are null; dates are never rewritten or inferred as Present. Source text is JSON-delimited untrusted data, with explicit instruction rejection and no tools. Schema/grounding failure produces no draft and retains the real charge. Human review remains necessary for associations, omitted facts, layout and source correctness; string grounding is not a proof of semantic correctness.
- Migration `20261001010000_resume_structuring` adds unique upload/run provenance, SHA-256 and extraction/prompt/schema versions to `ResumeVersion`, ownership-qualified composite foreign keys including Resume/upload/hash, complete-provenance CHECK, and the DB-owned budget policy. Manual versions remain compatible. Per-Resume row locking allocates monotonic versions across distinct concurrent uploads. Accepted result/accounting/run completion commit together, and the result is always `source=upload`, `status=draft`; no implicit acceptance. No duplicate extractedText or storage-object key is copied into the draft. Small evidence passages are retained to support review/audit.

## SDK, model and privacy research

Pinned `ai@7.0.126`, official `@openrouter/ai-sdk-provider@3.1.0`. `lib/ai` owns the provider/model boundary; feature code never selects providers/models. Uses `generateText` + `Output.object`, current `onStepEnd`, standard token usage and official `providerMetadata.openrouter.usage.cost`/provider name. Uses no generic OpenAI endpoint, registry or Neon AI Gateway.

Chosen `openai/gpt-6-luna` (read-only generation metadata confirmed actual snapshot `openai/gpt-6-luna-20260922`): factual structuring with strict output, low latency and low cost, verified against the current endpoint catalog. Routing is **Azure only**, `zdr=true`, `data_collection=deny`, `require_parameters=true`, strict schema, no fallback, usage accounting enabled, no plugins/tools, no SDK retries, 6,000 output tokens and a 60-second total timeout. Per-million price ceilings are $0.20 prompt/$1 completion and no fixed request fee. These plus the input/output bounds fit a conservative $0.05 request reserve. Two allowed dispatch attempts reserve $0.10 per logical operation.

The initial direct-OpenAI route failed before billing; the live ZDR catalog and official docs show that ZDR excludes first-party OpenAI and permits Azure. Privacy was retained while correcting routing. Routing eligibility can change; an empty compliant route fails closed rather than weakening privacy. Server-owned `OPENROUTER_API_KEY` is supplied through Function config/environment and never exposed to users. No source, prompt, model response, raw exception or personal data is logged. SDK request/response body inclusion is disabled.

Primary sources checked during implementation:

- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [generateText/settings](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).
- [Official OpenRouter provider/source](https://github.com/OpenRouterTeam/ai-sdk-provider), [strict output and required parameter routing](https://openrouter.ai/docs/guides/features/structured-outputs).
- [OpenRouter ZDR, including OpenAI→Azure routing](https://openrouter.ai/docs/guides/features/zdr), [data collection](https://openrouter.ai/docs/guides/privacy/data-collection), [live ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr), [Luna endpoint prices/support](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints).
- [Generation billing reconciliation](https://openrouter.ai/docs/api/api-reference/generations/get-generation), [Neon Function runtime](https://neon.com/docs/compute/functions/reference/runtime-limits).

Upstream JobSync extraction/schema/prompt were inspected. Reused bounded extraction and untrusted-source concepts; retained cloud's stronger ZIP checks and terminable PDF parsing, and replaced upstream best-effort defaults/inferred dates with strict null/grounding semantics.

## Durable allowance and billing behavior

`AiBudgetPolicy/resume` is database-owned: 10 operations/month, $1 owner monthly limit, $5 global daily limit, `enabled` kill switch. Missing/disabled policy fails closed. There is no subscription promise. Atomic admission uses a short advisory-lock transaction; concurrent invocations cannot over-reserve. Pending/uncertain cost remains held, including unresolved previous-day/month reservations. No expiration-based refund exists.

One reservation per logical operation; one usage row per dispatched provider attempt. The in-flight row commits before dispatch, and the SDK callback captures receipt ID/model/provider/tokens/actual cost immediately before output validation. Metadata is allowlisted: actual provider, exact reported USD charge, token details, finish reason, latency and privacy policy. Integer accounting rounds actual USD **up** to micro-USD while preserving the original reported USD value. Units settle once per operation, not per retry. Receipt capture, acceptance and reconciliation lock the reservation before usage and reread current state under the lock; concurrent reconciliation cannot erase accepted status or replace a discovered charge with an unknown value.

| Outcome | Ledger and product behavior |
| --- | --- |
| Valid full response, known cost | Usage succeeded; reservation settled; exactly one draft and succeeded run commit together. |
| Valid response, missing actual cost | Draft can succeed, with reservation/usage reconciliation required. Generation ID permits read-only billing recovery. |
| Invalid schema, malformed JSON, new facts | No draft; preserve tokens/receipt/charge and settle actual paid usage. No automatic repair/paid retry. |
| Explicit 400/401/402/403/404/422 rejection | Confirmed unbilled attempt, zero tokens/cost, release unused allowance, terminal failure. |
| Explicit 429 | Zero-cost rejected attempt; retain reservation for one bounded durable retry. A second 429 is terminal and releases unused allowance. |
| Network failure, 5xx, timeout, crash after dispatch marker | Unknown is not zero. Hold reservation, no automatic paid replay; fail safely on reclaim. |
| Crash/fence/cancellation after receipt | Keep receipt/accounting; stale/canceled workers cannot accept a draft. Reconcile billing by generation ID. Known paid result whose acceptance was interrupted is reported separately. |
| Ambiguous call with no generation ID | Remains reconciliation-required indefinitely pending operator/provider evidence. Absence of a generation is never proof of nonbilling. No automatic refund or resubmission. |
| Failure before dispatch | Existing bounded infrastructure backoff; document/content limits are terminal; terminal unused/confirmed-zero reservations are released by recovery. |

Recovery bounds discovery, processing, billing reconciliation and unused-reservation cleanup. The existing hourly `17 * * * *` cadence remains provisional; due retries/event-loss recovery can wait until the next wake. No undocumented queue/delivery guarantee is assumed. Kill switch prevents new reservation/dispatch; calls already dispatched still reconcile. Billing reconciliation never reconstructs a lost semantic result by submitting the resume again.

## Deployment, live proof and cleanup

Migration applied to the verified isolated database endpoint `ep-green-scene-b45djevq`, project `lively-shape-65452824`, branch `br-tiny-tree-b44fo1lv` (named production, unprotected isolated development foundation). Function `resumeworker`, object-created trigger and hourly recovery are deployed/enabled. Final plan changes only Function source/config; Auth and private bucket remain intact. External packages include unpdf and fast-xml-parser for isolated parser threads. Runtime is Node.js 24, with no Next/React dependency.

| Real sanitized proof | Model/provider | AI latency | Input/output tokens | Actual OpenRouter USD | Result |
| --- | --- | --- | --- | --- | --- |
| DOCX actual object trigger | GPT-6 Luna / Azure | 3,475 ms; 5,832 ms wall | 685 / 270 (68 reasoning included in output) | $0.000201465; 202 integer micro-USD | One draft; both runs attempt 1; no retry. |
| Signed-in browser PDF, leave/revisit | GPT-6 Luna / Azure | 5,871 ms | 685 / 296 (93 reasoning included in output) | $0.000214335; 215 integer micro-USD | Visible structured draft; exact facts/dates, null unknown phone; no retry. Desktop/mobile review notice; anonymous 401/missing 404. |
| Receipt-capture deployment, DOCX actual object trigger | GPT-6 Luna / Azure | 7,817 ms; 10,896 ms wall | 685 / 456 (152 reasoning included in output) | $0.000293535; 294 integer micro-USD | One draft; both runs attempt 1; receipt persisted before acceptance; no retry. |
| Final deployment, DOCX actual object trigger | GPT-6 Luna / Azure | 4,023 ms; 5,856 ms wall | 685 / 431 (125 reasoning included in output) | $0.000281160; 282 integer micro-USD | One draft; both runs attempt 1; no retry; cleaned. |

Total actual charge for the four successful proofs: **$0.000990495**. The initial privacy-ineligible route was rejected/unbilled.

Generation IDs: final deployment `gen-1790813411-rkazHCxlffwaSPjBZySo`; receipt-capture deployment `gen-1790812847-kNigRbZwh9O9EJ3usFDI`; DOCX `gen-1790812100-i9MrF81yKX6Y0hAa1ecy`; PDF `gen-1790812242-5FB9z5uWfOoovXCwmouW`. Each fixture preserved the employer, start/end dates, education, credential, two skills and explicitly absent phone; each had one version/one usage row and settled allowance. No full model response is included in this handoff.

All temporary objects, uploads, resumes, drafts, runs, usage/reservation rows, application profiles and the browser proof auth account were removed. Founder profile/auth identity and its records are preserved. Paid evidence is summarized here; fixture ledger rows are deliberately removed after isolated proof. Test fixtures in source are sanitized regression assets, not customer data.

## Validation

Passed existing suites: DB 9, auth 8, storage 29, document validation 10, worker 12. New AI suite: 35 (20 real-Postgres accounting/worker cases, 7 mocked official-provider boundary cases, 8 deterministic extraction cases). Total **103 tests, zero skips**. Covers 20-way replay/claim/reservation races, monthly/global admission, kill switch, duplicate drafts, concurrent version allocation, owner/hash isolation, actual/unknown/zero cost, 429 bounds, 5xx/network/timeout, malformed output, hallucinated facts, cancellation/fencing, crash receipts and generation reconciliation.

Frozen-lockfile install, Prisma validation/generation/deployment, database/storage smoke, TypeScript, production Next build, ESLint and diff checks pass. ESLint retains the two existing warnings in UI badge/image-card; no new warnings. Function bundling/deployment and real object-trigger proof pass. Browser QA uses the T3 collaborative preview; application shell remains unchanged. Historical proof-script cleanup now understands new draft/ledger relations.
