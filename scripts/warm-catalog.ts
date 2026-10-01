import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createDiscoveryWorker } from "../lib/domain/discovery/worker"
import { WARM_BOARDS, freshBoardFilter } from "../lib/domain/discovery/catalog"
import directory from "../lib/domain/discovery/directory.json"

nextEnv.loadEnvConfig(process.cwd())
assert.equal(
  process.env.JOBSYNC_WARM_CATALOG,
  "lively-shape-65452824/br-tiny-tree-b44fo1lv",
  "Explicit isolated production catalog opt-in required"
)
assert.ok(
  new URL(process.env.DATABASE_URL!).hostname.startsWith(
    "ep-green-scene-b45djevq"
  )
)
assert.ok(
  WARM_BOARDS.length <= 12,
  "Hard deployment budget: at most twelve service-warm boards"
)
const db = createDatabaseClient(process.env.DATABASE_URL!)
// Reviewed live provider snapshots absent from the upstream employer directory.
const additions: Record<string, string> = {
  "lever:spotify": "Spotify",
  "greenhouse:reddit": "Reddit",
}
const worker = createDiscoveryWorker(db, async () => {
  throw new Error("warm_catalog_cannot_dispatch_ai")
})
try {
  const results = []
  for (let offset = 0; offset < WARM_BOARDS.length; offset += 2) {
    results.push(
      ...(await Promise.all(
        WARM_BOARDS.slice(offset, offset + 2).map(async (entry) => {
          const name =
            directory.companies.find(
              (c) => c.provider === entry.provider && c.slug === entry.slug
            )?.name ?? additions[`${entry.provider}:${entry.slug}`]
          assert.ok(
            name,
            "Warm board must have a reviewed public directory identity"
          )
          const stem = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48)
          const digest = createHash("sha256")
            .update(name.trim().toLowerCase())
            .digest("hex")
            .slice(0, 10)
          const company = await db.company.upsert({
            where: { slug: `${stem}-${digest}` },
            create: { name, slug: `${stem}-${digest}` },
            update: {},
          })
          const board = await db.atsBoard.upsert({
            where: { provider_slug: entry },
            create: { ...entry, companyId: company.id },
            update: {},
          })
          const start = Date.now()
          const run = await worker.ensureBoard(board.id)
          const status = run ? await worker.ingest(run.id) : "already_fresh"
          const postings = await db.jobPosting.count({
            where: { boardId: board.id, open: true },
          })
          const current = await db.atsBoard.findUniqueOrThrow({
            where: { id: board.id },
          })
          return {
            ...entry,
            status,
            postings,
            fresh:
              current.enabled &&
              !!current.lastSuccessAt &&
              current.lastSuccessAt >= freshBoardFilter().lastSuccessAt.gte,
            latencyMs: Date.now() - start,
          }
        })
      ))
    )
  }
  console.info(
    JSON.stringify({
      warmBoards: results,
      openPostings: results.reduce((sum, r) => sum + r.postings, 0),
      aiCalls: 0,
    })
  )
  assert.ok(
    results.every(
      (r) => ["succeeded", "already_fresh"].includes(r.status) && r.fresh
    ),
    "Every intended warm board must be useful before release"
  )
} finally {
  await db.$disconnect()
}
