"use client"
import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Analytics } from "@vercel/analytics/next"
import { analyticsUrl } from "@/lib/analytics/events"
import { productEventOnce, metricStarted } from "@/lib/analytics/client"

export function ProductAnalytics() {
  const path = usePathname()
  const params = useSearchParams()
  useEffect(() => {
    if (path === "/auth/verify" && metricStarted("signup"))
      productEventOnce("signup_completed")
    if (
      path === "/pricing" ||
      path === "/dashboard/billing" ||
      (path === "/dashboard/settings" && params.get("tab") === "plan")
    )
      productEventOnce("upgrade_viewed")
  }, [path, params])
  return (
    <Analytics
      debug={false}
      beforeSend={(event) => {
        const url = analyticsUrl(event.url)
        return url ? { ...event, url } : null
      }}
    />
  )
}
