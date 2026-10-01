import { privateRead } from "@/lib/backend/private-read"
import { redirect } from "next/navigation"
import { requireCurrentProfile } from "@/lib/auth/context"
import { db } from "@/lib/db"
import { createDiscoveryService } from "@/lib/domain/discovery/service"
import { DiscoverFeed } from "@/components/discover-feed"
export default async function DiscoverPage() {
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  const initial = await privateRead(() => createDiscoveryService(db).read(user))
  return <DiscoverFeed initial={initial} />
}
