# Production activation and rotation

Updated 2026-10-01. Public origin: **https://jobsync-cloud.vercel.app**.
Operator: **Drew Sepeczi**. Private contact: **drewsepeczi@gmail.com**.
See [release evidence](RELEASE_2026-10-01.md) for tested behavior and limitations.
Never print credentials or put them in tickets, source, or deployment logs.

## Current release gates

**Invite-only beta; public charging disabled.** Do not enable
`BILLING_ROLLOUT_READY` until the paid lifecycle below is verified. The isolated
live-proof allowlist is empty. There is no automatic conversion from trial to a
paid subscription.

Remaining owner actions before broad public launch:

1. Resolve authentication-email inbox placement. Branded verification and
   recovery were delivered and worked, but Gmail classified both as spam.
   SPF/DKIM passed. A missing monitoring-only DMARC record on sitterfolio.com was
   added; a subsequent verification message still reached spam. Check sender
   reputation, provider/DNS alignment and real external recipient inboxes; prove
   verification and recovery from the inbox before opening broadly.
2. Perform a deliberately paid $6 live Checkout using a fresh isolated account.
   Verify the signed webhook grants Plus, inspect Portal, cancel immediately,
   confirm the cancellation webhook, and remove the isolated account/customer.
   The owner-requested 100% coupon proof produced a $0 paid invoice and verified
   entitlements, but proves no actual card charge. Only then consider enabling
   `BILLING_ROLLOUT_READY` in Vercel and the relevant worker environment and
   redeploy/recheck both.
3. Resolve JobSync product-name/trademark clearance. The repository MIT license
   covers software licensing; it does not establish product-name clearance.
4. Review applicable operator obligations, provider agreements and actual
   backup/log retention settings against the published Privacy and Terms.
   Public copy describes retention limits honestly and promises no immediate
   erasure from every provider backup.

Google is unavailable in the UI. To offer it, create a JobSync-specific Google
OAuth consent application and production client, configure its exact authorized
origin and the callback supplied by Neon Managed Auth, configure a custom Neon
provider, then prove signup, returning login, cancellation and failed callbacks.
Do not reuse another product's OAuth credentials or call Neon's shared provider
production-ready. Before OAuth-only signup, add and prove a supported recent-auth
or password-enrollment/recovery path for account deletion.

## Production identity and authentication

- Vercel hostname and `APP_ORIGIN`: https://jobsync-cloud.vercel.app.
- Root metadata base and landing canonical use the production origin.
- Neon Managed Auth production app: JobSync Cloud; exact trusted domain is the
  production origin, with localhost disabled.
- Production Object Storage CORS contains only that origin (PUT/GET/HEAD), no
  localhost or wildcard.
- Resend sender: **JobSync Cloud <jobsync@sitterfolio.com>** on an existing verified
  operator-owned domain. SMTP uses a dedicated sending-only, domain-scoped key.
- Real verification, password reset and new-password login passed for isolated
  identities. Their production sign-in identities and workspace data were deleted.
- Support, Privacy and Terms expose the confirmed operator and private email.
  Account/billing/privacy/security requests need not be posted publicly.

## Live Stripe configuration

The following configuration is live and mode-matched. It does **not** mean public
charging is enabled:

| Resource             | Production value                                     |
| -------------------- | ---------------------------------------------------- |
| Account              | `acct_1ULiCSDkevFaCoHn`                              |
| JobSync Plus product | `prod_VMX9z2YYBmUbTp`                                |
| Recurring price      | `price_1ULo56DkevFaCoHng5EMEqqx` ($6 USD/month)      |
| Portal               | `bpc_1ULoMwDkevFaCoHn46bdjOk6`                       |
| Webhook              | `we_1ULoMxDkevFaCoHnqAiCqmJj`                        |
| Webhook route        | https://jobsync-cloud.vercel.app/api/billing/webhook |

The approved restricted live key has eleven active permissions and no payout or
transfer access. Web and account worker carry matching live configuration. The
Portal supports payment/customer updates, invoice history and period-end
cancellation; redirects and legal URLs use the canonical origin.

Required webhook events are subscription created/updated/deleted, invoice
paid/payment_failed, and checkout.session.completed. Signature validation,
deduplication, replay and out-of-order behavior remain covered by the suite.
A success redirect never grants entitlement.

The isolated coupon was product/customer restricted, first-time only, once-only,
and limited to one redemption. The subscription was immediately canceled without
invoicing/proration and its customer removed. No renewal is scheduled. The
normal app-created Checkout used production redirects; the separate coupon-only
fixture accidentally used localhost for its success redirect, so the browser
was returned to production manually. The webhook still granted Plus independently
of that redirect. This is another reason not to label this a complete normal
paid-Checkout proof.

## Coordinated credential rotation

Deploy new configuration to web and Functions before revoking old credentials.
Neon Function environment updates merge values; explicitly clear retired optional
values instead of simply omitting them.

| Credential                     | Result                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Production database            | New application role; old owner password reset; old connection rejected                                           |
| Migration connection           | Rotated owner password in direct migration URL; runtime remains least-privilege role                              |
| Isolated test database         | Password rotated; old rejected; suite passed using new credentials                                                |
| Object Storage                 | New pair deployed; old key deleted and rejected                                                                   |
| Neon account-cleanup key       | New project-scoped key deployed; old deleted and rejected                                                         |
| App auth cookie secret         | Replaced; does not claim to revoke all Managed Auth primary sessions                                              |
| Discovery wake secret          | Replaced; old returns 401; current authenticates; overlap value explicitly cleared                                |
| Stripe test cleanup key        | Correct main-account test-mode replacement deployed; old key expired and rejected (401); new cleanup proof passed |
| Stripe old test webhook secret | Legacy test endpoint retired; old signature rejected; stale preview secret removed                                |
| Vercel OIDC                    | Old short-lived token expired; removed from local configuration                                                   |
| OpenRouter                     | Retained by explicit operator instruction; not rotated                                                            |

The main account's test-mode cleanup key is separate from the live billing key.
A separate Stripe sandbox has a different account ID and cannot clean up legacy
main-account test-mode records. A mistaken separate-sandbox rotation was caught
and corrected before release. The new main-account key passed a create/delete
proof through the real cleanup service with an isolated test customer. Preview
billing remains disabled; its key was replaced with the correct main-account key
and its obsolete webhook secret retired.
Keep migrations on the direct admin URL; runtime and Functions use the application
role. Never reset database passwords before deployments have working replacements.

## Measurement and feedback operations

Vercel Web Analytics is enabled. Fixed funnel events cover signup, verification,
resume upload/confirmation, discovery, first deterministic/AI results, save,
track/status progress, upgrade/Checkout and observed subscription activation.
Only bounded numeric elapsed times are custom properties. Known page paths are
allowlisted; query strings, fragments and unknown/dynamic paths are discarded.
No resume/job text, prompts/responses, email, notes, account IDs, application
content or signed URLs are sent by the instrumentation. Transport tests use
synthetic URL canaries to check this boundary.

Timings/first-event flags are browser-tab scoped and best effort; they are
approximate funnel signals, not exact lifetime user counts. Subscription events
are client observations of server-verified state; use Stripe's canonical records
for financial reporting. Vercel's own infrastructure/retention policies apply.

The in-app feedback page offers five categories, optional chosen text, no automatic
attachments, idempotent retries and five submissions per account per rolling day.
Feedback is privately stored, owner-scoped, exported and deleted with the account.
The operator can review `ProductFeedback` through the private Neon console. Use
private support email for account-specific replies; there is no automated delivery
or promise of a response SLA.

## Cleanup, error monitoring and recovery

The durable account worker retries provider failures after active leases and
existing upload links expire. Prove storage removal, managed identity/session
removal, private-record deletion, founder preservation and shared-catalog
preservation after material deployment changes. Minimal tombstones and anonymous
AI cost envelopes remain for anti-resurrection and conservative spend safeguards.

Existing Vercel structured error events contain generated IDs, route templates
and fixed codes. Request content and provider error details are sanitized. No new
third-party error-reporting stack or content-capture service was introduced.
