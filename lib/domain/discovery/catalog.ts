import type { Prisma } from "../../generated/prisma/client"

// Intentional service-owned coverage, not the employer directory. Adding a
// watch grows the reusable catalog without adding that board to this warm set.
export const WARM_BOARDS = [
  { provider: "greenhouse", slug: "figma" },
  { provider: "lever", slug: "spotify" },
  { provider: "ashby", slug: "linear" },
  { provider: "greenhouse", slug: "cloverhealth" },
  { provider: "greenhouse", slug: "gitlab" },
  { provider: "greenhouse", slug: "cloudflare" },
  { provider: "greenhouse", slug: "datadog" },
  { provider: "greenhouse", slug: "duolingo" },
  { provider: "greenhouse", slug: "reddit" },
  { provider: "greenhouse", slug: "airbnb" },
  { provider: "ashby", slug: "notion" },
  { provider: "greenhouse", slug: "stripe" },
] as const
export const FRESHNESS_MS = 6 * 60 * 60 * 1000
// A bounded grace window retains useful results through a transient fetch
// failure. Six-hour monitoring continues; last-success metadata stays honest.
export const MAX_CATALOG_AGE_MS = 24 * 60 * 60 * 1000
export function freshBoardFilter(now = new Date()) {
  return {
    enabled: true,
    lastSuccessAt: { gte: new Date(now.getTime() - MAX_CATALOG_AGE_MS) },
  }
}
export function warmBoardFilter(): Prisma.AtsBoardWhereInput {
  return { OR: WARM_BOARDS.map((b) => ({ ...b })) }
}
export function isWarmBoard(board: { provider: string; slug: string }) {
  return WARM_BOARDS.some(
    (b) => b.provider === board.provider && b.slug === board.slug
  )
}
