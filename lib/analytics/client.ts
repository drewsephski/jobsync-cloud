"use client"
import { track } from "@vercel/analytics"
import { eventProperties, productEvents, type ProductEvent } from "./events"

const prefix = "jobsync-metric:"
export function productEvent(event: ProductEvent, elapsedMs?: number) {
  if (!productEvents.includes(event) || typeof window === "undefined") return
  // Measurement is best effort and must never block a product action.
  try {
    track(event, eventProperties(elapsedMs))
  } catch {}
}
export function markMetric(name: "signup" | "find_jobs") {
  try {
    sessionStorage.setItem(`${prefix}${name}`, String(Date.now()))
  } catch {}
}
export function metricElapsed(name: "signup" | "find_jobs") {
  const start = metricStarted(name)
  return start ? Date.now() - start : undefined
}
export function metricStarted(name: "signup" | "find_jobs") {
  try {
    const start = Number(sessionStorage.getItem(`${prefix}${name}`))
    return start > 0 ? start : undefined
  } catch {
    return undefined
  }
}
export function beginSignupMetric() {
  if (metricStarted("signup")) return
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key)
  } catch {}
  markMetric("signup")
  productEventOnce("signup_started")
}
export function productEventOnce(event: ProductEvent, elapsedMs?: number) {
  try {
    const key = `${prefix}sent:${event}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, "1")
  } catch {
    return
  }
  productEvent(event, elapsedMs)
}
export function resetSearchMetric() {
  try {
    for (const event of ["first_results_shown", "first_ai_result_shown"])
      sessionStorage.removeItem(`${prefix}sent:${event}`)
  } catch {}
  markMetric("find_jobs")
  productEvent("find_jobs_clicked")
}
