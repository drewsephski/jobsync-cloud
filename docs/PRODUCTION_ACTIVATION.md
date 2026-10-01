# Production activation checklist

This checklist records provider configuration that must be verified before the
related feature is treated as launch-ready. Never commit credentials or copy
production secrets into previews, local files, or public documentation.

## Authentication email and Google sign-in

- Configure Neon Managed Auth's production app name, canonical trusted domain,
  and callback URLs for `https://jobsync-cloud.vercel.app` and any verified custom
  domain.
- Configure a production SMTP/email provider in Neon Managed Auth for verification
  and password recovery. Send real verification and recovery messages to isolated
  test accounts and verify the links return to the canonical origin.
- Add Google OAuth only after production client ID/secret, authorized origins,
  redirect URI, and Neon Managed Auth provider configuration are available.
  Complete signup, returning-user login, cancellation, and callback-failure tests.
- Remove localhost from production trusted origins and redirects. Keep local and
  preview OAuth credentials isolated from production.
- No SMTP credentials or production Google OAuth credentials are currently
  available in this repository. Do not enable these flows by inventing values.

## Stripe live billing

Live charging is disabled. `.env.example` sets `STRIPE_MODE=test` and
`BILLING_ROLLOUT_READY=false`. Do not change either setting until every item below
is provisioned for the same live Stripe account and verified end to end:

- Live JobSync Plus product and recurring monthly price at the advertised amount.
- Matching live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, product ID, and price
  ID in the Vercel application environment.
- A live webhook endpoint subscribed to the required subscription and invoice
  events, with signature and replay checks passing against the production route.
- Stripe Customer Portal configuration that permits the intended payment-method
  updates and cancellation behavior, plus its matching configuration ID.
- Matching live configuration in every worker or scheduled process that touches
  subscription state; verify webhook retries, duplicate/out-of-order events,
  cancellation, renewal, and failed-payment recovery.
- Production checkout, portal, webhook, entitlement, and account-deletion lifecycle
  proof using isolated live-mode fixtures, with all test subscriptions and records
  cleaned up afterward.

Do not use test product/price IDs or secrets in a live-mode deployment. Keep live
charging disabled until the application and worker configurations have both been
verified against the same live account.

## Error monitoring and privacy

Next.js uncaught server request errors emit a minimal structured event to the
existing Vercel runtime log stream. The event includes a generated error ID, route
template, route type, router kind, and runtime; it excludes exception text, stack,
request URL/query, headers, bodies, and user identifiers. Vercel project access and
log retention remain governed by the configured Vercel account.

Private workspace reads replace database/provider error messages, causes and
stacks with a fixed failure before Next.js's default logger receives them. The
canary tests cover this boundary as well as the request-error event allowlist.

The repository does not configure a third-party error-reporting service. If an
external monitor is added later, require explicit content capture to remain off,
scrub request data and secrets before transport, and verify with synthetic
canaries that resumes, prompts, AI responses, signed URLs, credentials, emails,
and other private content cannot appear in events.

## Account cleanup and access

- Account cleanup uses a dedicated project-scoped Neon API key for production
  project `lively-shape-65452824`, branch `br-tiny-tree-b44fo1lv`. The web app and
  scheduled account worker must share `NEON_ACCOUNT_CLEANUP_API_KEY`,
  `NEON_ACCOUNT_CLEANUP_PROJECT_ID`, and `NEON_ACCOUNT_CLEANUP_BRANCH_ID`.
- Verify worker database/storage bindings and its five-minute recovery trigger
  after every deployment. Prove storage removal, directory-user removal, session
  invalidation, and tenant/public-posting isolation using temporary accounts.
- The durable cleanup ledger deliberately survives profile deletion. Minimal
  account IDs prevent resurrection and allow retries; anonymous AI cost envelopes
  retain unresolved charges conservatively without an account link.
- Current account deletion reauthenticates an email/password account. Before
  activating OAuth-only signup, add and prove a supported recent-auth or password
  enrollment/recovery path for those accounts.
- Review the legal operator/contact information, actual backup/log retention,
  provider agreements, and privacy/terms with the responsible operator before a
  broad public launch. The public GitHub issue link is for non-private support;
  establish a private support channel for sensitive account requests.

## Coordinated credential rotation

During launch QA, local credential values appeared in internal tool output.
Do not copy those values into tickets, documentation, or deployment logs. Rotate
in a coordinated rollout and verify both web and workers before retiring old keys:

- Neon database roles/connection strings (`DATABASE_URL`,
  `DATABASE_URL_UNPOOLED`, and the schema-only `BILLING_TEST_DATABASE_URL`).
- Object Storage access key pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- Neon Auth cookie secret (`NEON_AUTH_COOKIE_SECRET`); rotation invalidates
  existing application sessions and requires users to sign in again.
- OpenRouter API key (`OPENROUTER_API_KEY`) in Vercel and resume/discovery workers.
- Stripe test secret/webhook secret (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`) in Vercel and any billing cleanup worker. Keep the
  existing test-mode product, price, portal and webhook configuration matched.
- The short-lived Vercel OIDC token emitted by an environment pull should expire;
  confirm no persistent token or file was retained.

The dedicated account-cleanup key was provisioned without printing its value.
No credentials were rotated automatically during this launch pass.
