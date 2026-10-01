import { redirect } from "next/navigation"
export default async function Billing({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const params = await searchParams
  redirect(
    `/dashboard/settings?tab=plan${params.checkout ? `&checkout=${encodeURIComponent(params.checkout)}` : ""}`
  )
}
