import nextEnv from "@next/env"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { AtsProvider } from "../lib/generated/prisma/enums"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import directory from "../lib/domain/discovery/directory.json"

nextEnv.loadEnvConfig(process.cwd())

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, "DATABASE_URL is required")
const databaseHost = new URL(databaseUrl).hostname
assert.ok(
  databaseHost.startsWith("ep-green-scene-b45djevq"),
  "discovery directory seeding is restricted to the verified isolated Neon branch"
)

type DirectoryProvider = keyof typeof AtsProvider
type DirectoryCompany = {
  name: string
  provider: DirectoryProvider
  slug: string
  key: string
  region: "global" | "eu" | null
}

const companies = directory.companies as DirectoryCompany[]
const boardKeyPattern = /^(greenhouse|lever|ashby):([a-z0-9][a-z0-9_-]{1,79})$/
const companyBySlug = new Map<string, { name: string; slug: string }>()
const boardRows = companies.map((company) => {
  const parsed = boardKeyPattern.exec(company.key)
  assert.ok(parsed, `Invalid directory board key: ${company.key}`)
  assert.equal(parsed[1], company.provider, `Provider mismatch: ${company.key}`)
  assert.equal(
    parsed[2],
    company.slug,
    `Board key/token mismatch: ${company.key}`
  )

  const companySlug = makeCompanySlug(company.name)
  const previous = companyBySlug.get(companySlug)
  assert.ok(
    !previous || previous.name.toLowerCase() === company.name.toLowerCase(),
    `Company slug collision: ${previous?.name} and ${company.name}`
  )
  companyBySlug.set(companySlug, { name: company.name, slug: companySlug })

  return {
    companySlug,
    provider: AtsProvider[company.provider],
    // The composite directory key identifies the provider/token pair; the
    // persisted slug stays the raw token expected by the public ATS adapter.
    slug: company.slug,
    region: company.region ?? "global",
  }
})

const db = createDatabaseClient(databaseUrl)

try {
  const companyRowsToSeed = [...companyBySlug.values()]
  await db.company.createMany({ data: companyRowsToSeed, skipDuplicates: true })

  const persistedCompanies = await db.company.findMany({
    where: { slug: { in: companyRowsToSeed.map(({ slug }) => slug) } },
    select: { id: true, slug: true },
  })
  const companyIds = new Map(
    persistedCompanies.map(({ id, slug }) => [slug, id])
  )

  const boardData = boardRows.map((board) => {
    const companyId = companyIds.get(board.companySlug)
    assert.ok(companyId, `Missing seeded company ${board.companySlug}`)
    return {
      companyId,
      provider: board.provider,
      slug: board.slug,
      region: board.region,
    }
  })

  const result = await db.atsBoard.createMany({
    data: boardData,
    skipDuplicates: true,
  })

  console.info(
    `Discovery directory seeded: ${companyRowsToSeed.length} companies, ${boardData.length} board definitions (${result.count} new boards).`
  )
} finally {
  await db.$disconnect()
}

function makeCompanySlug(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  const stem = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
  const digest = createHash("sha256")
    .update(normalized.trim().toLowerCase())
    .digest("hex")
    .slice(0, 10)
  return `${stem || "company"}-${digest}`
}
