import { requireCurrentProfile } from "@/lib/auth/context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireCurrentProfile()
  return <main className="mx-auto w-full max-w-3xl p-6">{children}</main>
}
