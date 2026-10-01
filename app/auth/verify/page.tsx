import { redirect } from "next/navigation"
import { requireCurrentAuthUser } from "@/lib/auth/context"
import { AuthEmailFlow } from "@/components/auth-email-flow"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export default async function VerifyEmail() {
  const user = await requireCurrentAuthUser()
  if (user.emailVerified) redirect("/onboarding")
  if (!user.email) redirect("/dashboard/billing")
  return <AuthEmailFlow verificationEmail={user.email} />
}
