# JobSync Cloud billing

Billing is implemented and deployed in **Stripe test mode**. Public paid rollout remains disabled. Only explicitly allowlisted isolated auth IDs can open sandbox Checkout or Portal. No live charge was made. Live selling requires the separate production Stripe configuration below.

## Plans and economic limits

| Allowance | Verified 14-day trial | Plus · $6 USD/month |
| --- | --- | --- |
| Resume AI runs | 2 for the entire trial | 5 per Stripe billing period |
| Job AI analyses | 5 for the entire trial | 60 per Stripe billing period |
| Watched public company boards | 3 | 30 |
| Discovery planning | At most 2/day UTC, at least 12 hours apart | Same cadence |

Manual application tracking and confirmed resume editing are included. Saved records remain readable after expiry. Discovery is recurring background work, subject to public board availability; it does not promise immediate or unlimited results. Future Plus features do not alter these current limits.

The existing durable AI reservation, receipt, and kill-switch system enforces both human-unit caps and money limits. The trial cost ceiling is $0.30 and Plus ceiling is $1.50 per billing period. Worst-case reservations fit all included units: trial `2 × $0.10 + 5 × $0.015 = $0.275`; Plus `5 × $0.10 + 60 × $0.015 = $1.40`. The $5 global daily safeguard and policy kill switch remain. Actual provider failures, unresolved receipts, or global safeguards can temporarily pause work; the UI says so. Reservations across a period change retain unresolved cost conservatively. Units are counted when processing starts, not when a button is clicked.

## Entitlement and payment boundary

`lib/billing/entitlements.ts` is the application-owned boundary. Requests and workers read local durable state; valid local access does not call Stripe. A verified trusted auth session starts one nonrenewable 14-day trial. Reverification or repeat signup requests cannot reset it.

Only configured product/price, one item, quantity one, $6 USD/month subscriptions can grant Plus. Active requires a paid latest invoice; trialing is bounded by Stripe's trial date. Paid access ends at the locally recorded finite period boundary, shortened by `cancel_at` where applicable. Scheduled cancellation supports both `cancel_at` and `cancel_at_period_end`. Past-due, unpaid, canceled, paused, incomplete, expired, foreign-mode, and wrong-price state cannot grant Plus. A still-valid application trial can remain after paid cancellation.

Signed raw-body webhooks reconcile the **entire canonical customer subscription list**, under an owner lock acquired before retrieval. Reconciliation and event ledger commit atomically. Duplicate, replayed, stale, and out-of-order event payloads cannot overwrite current state with an old subscription. Stripe unavailability returns a retryable 503 without acknowledging success. The Checkout return page never grants access. Cancel/renewal/resubscription events update local provenance; a previous subscription cannot supersede the newer customer snapshot.

Checkout uses a durable mode-specific customer placeholder, Stripe metadata recovery and idempotency, owner serialization, an open-session reuse path, and terminal-subscription checks. An asynchronous failed payment clears only its exact Checkout attempt. Test/live customers and entitlement reads remain separate. Billing management remains available for expired accounts. Browser mutations require the exact app origin.

## Existing users and founder safety

Migration preserves all profiles, private resumes, applications, and public discovery records. No existing account receives perpetual Plus. Existing users receive the same one-time finite 14-day trial on their first trusted verified session. Unverified users can sign in, review saved records, verify email, and access account/billing; they cannot spend AI or start discovery.

During setup (`BILLING_ROLLOUT_READY=false`) existing core tracking/editing continues, while AI/discovery are still bounded. Test mode also never enables a public paid core gate. There is no first-account founder heuristic or hardcoded perpetual founder grant. Before live activation, explicitly verify the founder's real existing identity and finite trial/paid access in the deployed app; preserve its auth credentials and records. Automated proof uses an exact separate identity, never the founder account.

## Production configuration and activation

Server-only variables are documented in `.env.example`. Set encrypted Vercel Production variables for `STRIPE_MODE=live`, `STRIPE_SECRET_KEY` (`sk_live_`), live `STRIPE_PLUS_PRODUCT_ID`, `STRIPE_PLUS_PRICE_ID`, live `STRIPE_WEBHOOK_SECRET`, and optionally `STRIPE_PORTAL_CONFIGURATION_ID`. Keep `APP_ORIGIN` exact. Create the live price at $6 USD/month, enable Portal payment updates/invoices and cancellation, and register `/api/billing/webhook` for subscription, invoice and Checkout lifecycle events. Verify webhook delivery, ownership/mode, and deployment before setting `BILLING_ROLLOUT_READY=true`. Update Neon worker `STRIPE_MODE=live` together with the app. Clear `BILLING_TEST_ALLOWED_USER_IDS`. Sandbox subscriptions never become live entitlements.

Do not enable the paid rollout while users cannot buy a live subscription. Changing a secret alone without matching price/product/webhook/worker mode is rejected or fails closed. Monitor failed webhook delivery and retries; the endpoint acknowledges only committed reconciliation. `scripts/configure-billing-test.ts` is deliberately sandbox-only and writes secrets only to ignored local environment files.

## Managed Neon Auth

Neon Auth remains independent of Stripe; no Better Auth payment plugin or self-hosted auth was introduced. The application identity is JobSync Cloud. The sole trusted production origin is `https://jobsync-cloud.vercel.app`; localhost connections are disabled after browser proof. Signup verification OTP, password recovery delivery, password reset, and sign-in with the new password were exercised through the deployed provider. `require_email_verification` remains false at the provider sign-in layer to preserve existing/founder login; application verification gates all billable trial use.

Shared Google OAuth and shared Neon email (`auth@mail.myneon.app`) remain configured. A custom sender/domain and Google client require the owner's provider credentials and domain verification; they were not falsely marked complete. A future custom application domain must be added explicitly to trusted origins, storage CORS and APP_ORIGIN, with OAuth redirects updated together.

## Verification

`pnpm test` runs all database suites against the schema-only Neon test branch, without copying production records or racing deployed cron workers. Configure ignored `.env.billingtest` with `BILLING_TEST_DATABASE_URL`; the harness pins the reviewed test endpoint and rejects production. Run one suite process at a time because kill-switch tests intentionally mutate isolated global policy. Individual DB test commands require the isolated URL environment too. The real Stripe proof is separate from fake-adapter lifecycle tests.

Real proof on October 1, 2026: separate signup, actual email OTP verification, sanitized private DOCX upload, actual AI draft/receipt, user confirmation, targets, manual application, company watch, deployed recurring discovery scan and cadence denial, hosted $6 Sandbox Checkout using Stripe's test card, verified Checkout/invoice/subscription webhooks granting finite Plus, Portal invoice/payment view, scheduled cancellation, cancellation reversal, repeat scheduled cancellation, recovery email/OTP reset and sign-in with the new password. Modern `cancel_at` portal behavior was discovered in this proof and added as a regression test. No real card was charged.

Final verification: 158/158 tests passed, TypeScript and production build passed, lint passed with two pre-existing UI warnings. The proof subscription was immediately canceled in test mode and its real webhook removed Plus, retaining only the original still-valid trial. The exact temporary auth identity, private application/resume/AI records, one private storage object, local billing records and sandbox customer were removed; founder presence was checked before and after. The sandbox allowlist was cleared from local and encrypted deployed configuration. The schema-only test branch is retained for repeatable tests, with no production records copied and no remaining fixture profiles/customers/companies.

Fake-adapter/Postgres tests additionally cover paid renewals, delinquency, immediate cancellation, new subscription replacement, mode/price/customer isolation, duplicate/replayed/concurrent delivery, customer/session races, async failed Checkout retry, canonical Stripe outage with valid local access, verified trial and Plus AI caps, and concurrent watch/scan admission. Real renewal/payment-failure test-clock behavior was not exercised; these lifecycle cases are covered by canonical adapter tests.
