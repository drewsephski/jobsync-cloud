# JobSync Cloud

Next.js 16 application. This first implementation step provides only the Neon
Postgres persistence foundation. Authentication, workers, storage, AI, and billing
are not implemented.

Use Node.js 22.12+ or 24 LTS and pnpm (the repository pins pnpm in `package.json`).

```bash
pnpm install
pnpm dev
```

## Database configuration

Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your isolated Neon
development database's pooled connection string. Credentials stay in ignored local
environment files; never use a `NEXT_PUBLIC_` variable for database access.

`DATABASE_URL_UNPOOLED` is optional and overrides the connection used by Prisma CLI.
When absent, the CLI derives Neon's direct hostname by removing `-pooler` from the
Neon endpoint hostname in `DATABASE_URL`; other providers use the URL unchanged.
The runtime always uses `DATABASE_URL` with `@prisma/adapter-neon`. This keeps schema
operations off the pooler without requiring another secret. Prisma CLI and smoke
tests load environment files using Next.js's environment loader.

Prisma 7.10 uses `prisma.config.ts` for CLI connections and the `prisma-client`
generator with a local, ignored output directory. Install and build regenerate the
client. No generated client or credentials belong in Git.

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate --name describe_change  # isolated development database only
pnpm db:deploy                       # apply committed migrations, including initial setup
pnpm db:studio
pnpm db:smoke                        # read-only adapter/connection/table check
pnpm db:test                         # integration checks; all test writes roll back
pnpm lint
pnpm typecheck
pnpm build
```

Do not use `db push` or reset a populated database as a migration workflow. Review
migration SQL before applying it. The initial migration was generated with
`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, then
reviewed and applied with `prisma migrate deploy`. Existing `neon_auth` tables are
outside the application schema and must remain managed by Neon.

## Persistence boundaries

- `UserProfile.id` will be the managed-auth identity ID; no auth tables are modeled.
- Resume/version and reservation/usage links use ownership-qualified foreign keys.
  Resume edits create new version snapshots; version content immutability and
  monotonic allocation beyond the unique positive version number must be enforced
  by the future application write path. No active-version pointer is introduced yet.
- All timestamps use UTC instants (`timestamptz`). JSON uses JSONB; keywords use a
  Postgres text array. Compensation is whole annual USD; AI cost is integer micro-USD.
- Run and reservation idempotency keys are globally unique, including service-owned
  runs. Future callers must namespace keys by owner, operation, and logical request.
- Processing runs persist retries, leases, checkpoints, and cancellation. Future
  workers must claim atomically and qualify checkpoints/completion by the current
  lease token. The schema alone does not implement stale-worker protection or retries.
- Accounting distinguishes unknown final usage/cost (`null`) from confirmed zero.
  Reconciliation is explicit; expiration never implies an automatic refund.
- Deletes restrict dependent records so future account cleanup can reconcile work
  and accounting deliberately. Database ownership constraints do not replace
  authorization in the future server application.
- The initial migration includes Postgres CHECK constraints for positive versions,
  nonnegative accounting/attempts, paired leases, running leases, and billing periods.
  Prisma does not model these checks; preserve them in subsequent migrations.

`lib/db.ts` and `lib/db-health.ts` are server-only. Database callers in Next.js must
use the Node runtime. The smoke/test scripts enable Node's `react-server` condition
so the same guarded server module can run outside Next.js. No public health route
or browser database API is exposed.

## UI primitives

Existing shadcn components remain available. Add components using pnpm:

```bash
pnpm dlx shadcn@latest add button
```
