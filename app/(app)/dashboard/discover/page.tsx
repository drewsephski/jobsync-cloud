import { privateRead } from "@/lib/backend/private-read"
import { redirect } from "next/navigation"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { createDiscoveryService } from "@/lib/domain/discovery/service"
import { DiscoverFeed } from "@/components/discover-feed"
import { after } from "next/server"
import { wakeDiscovery } from "@/lib/domain/discovery/wake"
import { createDiscoveryPlanner } from "@/lib/domain/discovery/planner"
export const maxDuration = 60
export default async function DiscoverPage() {
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  const initial = await privateRead(async () => {
    const funnel = await createDiscoveryPlanner(db)(user.id)
    if (funnel.queued) after(() => wakeDiscovery({ ownerUserId: user.id }))
    return createDiscoveryService(db).read(user)
  })
  return <DiscoverFeed initial={initial} />
}
