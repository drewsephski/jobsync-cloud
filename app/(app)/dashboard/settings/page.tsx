import { privateRead } from "@/lib/backend/private-read"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { billingSummary } from "@/lib/billing/service"
import {
  billingMode,
  billingCheckoutAvailable,
  testBillingAllowed,
} from "@/lib/billing/entitlements"
import { createDiscoveryService } from "@/lib/domain/discovery/service"
import { SettingsAccount } from "@/components/ui/settings-account"
import { createMcpTokenService } from "@/lib/mcp/tokens"
import { serverEnv } from "@/lib/server-env"
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; checkout?: string }>
}) {
  const { user, profile } = await requireCurrentProfile()
  const [summary, customer, files, discover, params, mcpTokens] =
    await privateRead(() =>
      Promise.all([
        billingSummary(db, user.id),
        db.billingCustomer.findUnique({
          where: {
            ownerUserId_livemode: {
              ownerUserId: user.id,
              livemode: billingMode(),
            },
          },
        }),
        db.resumeUpload.findMany({
          where: { ownerUserId: user.id, status: "uploaded" },
          select: { id: true, originalFileName: true },
          orderBy: { createdAt: "desc" },
        }),
        profile.onboardingCompletedAt
          ? createDiscoveryService(db).read(user)
          : null,
        searchParams,
        createMcpTokenService(db).list(user),
      ])
    )
  return (
    <SettingsAccount
      name={profile.displayName ?? user.name ?? ""}
      timezone={profile.timezone ?? "UTC"}
      email={user.email}
      summary={summary}
      manage={
        !!customer?.stripeCustomerId &&
        (billingMode() || testBillingAllowed(user.id))
      }
      upgrade={billingCheckoutAvailable(user.id)}
      discover={discover}
      files={files.map((f) => ({ id: f.id, fileName: f.originalFileName }))}
      checkout={params.checkout}
      initialTab={params.tab ?? "account"}
      mcpTokens={mcpTokens}
      appOrigin={serverEnv.APP_ORIGIN}
    />
  )
}
