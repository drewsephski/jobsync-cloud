import assert from "node:assert/strict"
import { test } from "node:test"
import {
  fetchBoard,
  type CanonicalJob,
} from "../lib/domain/discovery/providers"
import { fingerprint } from "../lib/domain/discovery/relevance"

type RequestRecord = { url: string; init?: RequestInit }
function stub(
  responses: unknown[],
  records: RequestRecord[] = []
): typeof fetch {
  let index = 0
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    records.push({ url: String(input), init })
    const response = responses[index++]
    if (response instanceof Error) throw response
    if (response === undefined) throw new Error("Unexpected provider request")
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

const ghJob = (overrides: Record<string, unknown> = {}) => ({
  id: 123,
  title: "Staff Engineer",
  location: { name: "New York, NY" },
  first_published: "2026-01-02T03:04:05Z",
  absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
  content:
    "&amp;lt;p&amp;gt;Build systems&amp;lt;/p&amp;gt;&amp;lt;script&amp;gt;steal()&amp;lt;/script&amp;gt;",
  ...overrides,
})

const ashbyJob = (overrides: Record<string, unknown> = {}) => ({
  id: "ashby-id",
  title: "Product Engineer",
  location: "Remote - US",
  secondaryLocations: [{ location: "Toronto" }],
  isListed: true,
  isRemote: true,
  workplaceType: "Remote",
  publishedAt: "2026-02-03T04:05:06.000Z",
  jobUrl: "https://jobs.ashbyhq.com/acme/ashby-id",
  descriptionPlain: "Ship product features",
  ...overrides,
})

test("Greenhouse normalizes a full content snapshot and safely decodes HTML", async () => {
  const result = await fetchBoard(
    { provider: "greenhouse", slug: "acme", region: "global" },
    stub([{ meta: { total: 1 }, jobs: [ghJob()] }])
  )
  assert.equal(result.length, 1)
  assert.equal(result[0]?.externalId, "123")
  assert.equal(result[0]?.title, "Staff Engineer")
  assert.equal(result[0]?.description, "Build systems")
  assert.equal(result[0]?.location, "New York, NY")
  assert.equal(
    result[0]?.publishedAt?.toISOString(),
    "2026-01-02T03:04:05.000Z"
  )
  assert.match(result[0]?.contentHash ?? "", /^[a-f0-9]{64}$/)
  assert.equal(
    result[0]?.contentHash,
    fingerprint({
      externalId: "123",
      title: "Staff Engineer",
      location: "New York, NY",
      remote: null,
      description: "Build systems",
      originalUrl: "https://boards.greenhouse.io/acme/jobs/123",
      publishedAt: "2026-01-02T03:04:05.000Z",
    })
  )
})

test("Greenhouse keeps a safe company-owned careers URL as the original posting URL", async () => {
  const result = await fetchBoard(
    { provider: "greenhouse", slug: "acme", region: "global" },
    stub([
      {
        meta: { total: 1 },
        jobs: [
          ghJob({ absolute_url: "https://careers.acme.com/openings/123" }),
        ],
      },
    ])
  )
  assert.equal(result[0]?.originalUrl, "https://careers.acme.com/openings/123")
})

test("Lever paginates to a short final page and uses the EU host when requested", async () => {
  const requests: RequestRecord[] = []
  const makeLever = (id: string, additions: Record<string, unknown> = {}) => ({
    id,
    text: "Senior Backend Engineer",
    categories: { location: "Dublin", allLocations: ["Dublin"] },
    workplaceType: "hybrid",
    descriptionPlain: "Build reliable services",
    lists: [{ text: "Requirements", content: "<ul><li>Postgres</li></ul>" }],
    additionalPlain: "Equal opportunity employer",
    hostedUrl: `https://jobs.eu.lever.co/acme/${id}`,
    createdAt: 1780000000000,
    ...additions,
  })
  const fetcher = stub(
    [
      Array.from({ length: 100 }, (_, i) => makeLever(`job-${i}`)),
      [makeLever("job-100", { workplaceType: "onsite" })],
    ],
    requests
  )
  const result = await fetchBoard(
    { provider: "lever", slug: "acme", region: "eu" },
    fetcher
  )
  assert.equal(result.length, 101)
  assert.equal(result[0]?.remote, false)
  assert.equal(result[0]?.publishedAt, null)
  assert.equal(result.at(-1)?.remote, false)
  assert.match(result[0]?.description ?? "", /Postgres/)
  assert.match(result[0]?.description ?? "", /Equal opportunity employer/)
  assert.match(
    requests[0]?.url ?? "",
    /^https:\/\/api\.eu\.lever\.co\/v0\/postings\/acme\?mode=json&skip=0&limit=100$/
  )
  assert.match(requests[1]?.url ?? "", /skip=100&limit=100$/)
  assert.equal(requests[0]?.init?.redirect, "error")
})

test("Ashby excludes unlisted jobs, retains published date and joins locations", async () => {
  const result = await fetchBoard(
    { provider: "ashby", slug: "acme", region: "global" },
    stub([
      {
        apiVersion: "1",
        jobs: [ashbyJob(), ashbyJob({ id: "private-link", isListed: false })],
      },
    ])
  )
  assert.equal(result.length, 1)
  assert.equal(result[0]?.externalId, "ashby-id")
  assert.equal(result[0]?.location, "Remote - US; Toronto")
  assert.equal(result[0]?.remote, true)
  assert.equal(
    result[0]?.publishedAt?.toISOString(),
    "2026-02-03T04:05:06.000Z"
  )
})

test("identical duplicate snapshots deduplicate but conflicting duplicates fail closed", async () => {
  const duplicate = ghJob()
  const result = await fetchBoard(
    { provider: "greenhouse", slug: "acme", region: "global" },
    stub([{ meta: { total: 2 }, jobs: [duplicate, duplicate] }])
  )
  assert.equal(result.length, 1)
  await assert.rejects(
    fetchBoard(
      { provider: "greenhouse", slug: "acme", region: "global" },
      stub([
        {
          meta: { total: 2 },
          jobs: [duplicate, ghJob({ title: "Different title" })],
        },
      ])
    ),
    /conflicting duplicate/
  )
})

test("incomplete snapshots, malformed records, unsafe URLs and HTTP failures reject", async () => {
  const board = {
    provider: "greenhouse" as const,
    slug: "acme",
    region: "global",
  }
  await assert.rejects(
    fetchBoard(board, stub([{ meta: { total: 2 }, jobs: [ghJob()] }])),
    /Incomplete Greenhouse/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([{ meta: { total: 1 }, jobs: [ghJob({ title: null })] }])
    ),
    /title/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([
        {
          meta: { total: 1 },
          jobs: [
            ghJob({
              absolute_url: "http://boards.greenhouse.io/acme/jobs/123",
            }),
          ],
        },
      ])
    ),
    /Unsupported posting URL/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([
        {
          meta: { total: 1 },
          jobs: [ghJob({ absolute_url: "https://attacker.example/jobs/123" })],
        },
      ])
    ),
    /Unsupported posting URL/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([
        {
          meta: { total: 1 },
          jobs: [ghJob({ absolute_url: "https://127.0.0.1/jobs/123" })],
        },
      ])
    ),
    /Unsupported posting URL/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([
        {
          meta: { total: 1 },
          jobs: [
            ghJob({
              absolute_url: "https://user:secret@careers.acme.com/jobs/123",
            }),
          ],
        },
      ])
    ),
    /Unsupported posting URL/
  )
  await assert.rejects(
    fetchBoard(
      board,
      stub([
        {
          meta: { total: 1 },
          jobs: [ghJob({ absolute_url: "javascript:alert(1)" })],
        },
      ])
    ),
    /Unsupported posting URL/
  )
  await assert.rejects(
    fetchBoard(board, stub([new Error("network failure")])),
    /network failure/
  )
  await assert.rejects(
    fetchBoard(
      board,
      (async () => new Response("unavailable", { status: 503 })) as typeof fetch
    ),
    /HTTP 503/
  )
})

test("board slugs and regions are validated before any network request", async () => {
  let called = false
  const fetcher = (async () => {
    called = true
    return new Response("{}")
  }) as typeof fetch
  await assert.rejects(
    fetchBoard(
      { provider: "greenhouse", slug: "../secret", region: "global" },
      fetcher
    ),
    /slug/
  )
  await assert.rejects(
    fetchBoard(
      { provider: "greenhouse", slug: "acme", region: "apac" },
      fetcher
    ),
    /region/
  )
  assert.equal(called, false)
})

test("responses above the global byte bound are rejected", async () => {
  const body = `{"meta":{"total":0},"jobs":[],"padding":"${"x".repeat(20 * 1024 * 1024)}"}`
  const fetcher = (async () => new Response(body)) as typeof fetch
  await assert.rejects(
    fetchBoard(
      { provider: "greenhouse", slug: "acme", region: "global" },
      fetcher
    ),
    /byte limit/
  )
})

test("Lever repeated IDs and a board that fills every allowed page reject as truncated", async () => {
  const leverBoard = {
    provider: "lever" as const,
    slug: "acme",
    region: "global",
  }
  const repeated = {
    id: "same",
    text: "Engineer",
    hostedUrl: "https://jobs.lever.co/acme/same",
  }
  await assert.rejects(
    fetchBoard(leverBoard, stub([[repeated, repeated]])),
    /repeated a job ID/
  )

  const fullPage = (offset: number) =>
    Array.from({ length: 100 }, (_, index) => ({
      id: `job-${offset + index}`,
      text: "Engineer",
      hostedUrl: `https://jobs.lever.co/acme/job-${offset + index}`,
    }))
  let requests = 0
  const fetcher = (async () => {
    const page = fullPage(requests * 100)
    requests += 1
    return new Response(JSON.stringify(page))
  }) as typeof fetch
  await assert.rejects(fetchBoard(leverBoard, fetcher), /pagination limit/)
  assert.equal(requests, 30)
})

test("content descriptions are capped at the configured public text size", async () => {
  const long = "x".repeat(17_000)
  const ashby: CanonicalJob[] = await fetchBoard(
    { provider: "ashby", slug: "acme", region: "global" },
    stub([{ apiVersion: "1", jobs: [ashbyJob({ descriptionPlain: long })] }])
  )
  assert.equal(ashby[0]?.description.length, 16_000)
})

test("oversized canonical identity fields reject the entire board snapshot", async () => {
  await assert.rejects(
    fetchBoard(
      { provider: "greenhouse", slug: "acme", region: "global" },
      stub([{ meta: { total: 1 }, jobs: [ghJob({ title: "x".repeat(501) })] }])
    ),
    /Oversized canonical job field/
  )
})

test("oversized matching input is rejected before provider dispatch", async () => {
  const { createMatcher } = await import("../lib/ai/matching")
  const result = await createMatcher("unused-test-key")({
    resume: {
      summary: "x".repeat(60_001),
      skills: [],
      employment: [],
      education: [],
      credentials: [],
    },
    targets: [],
    posting: { title: "Engineer", description: "Build APIs" },
  })
  assert.equal(result.errorCode, "matching_context_too_large")
  assert.equal(result.definitelyUnbilled, true)
  assert.equal(result.receipt, null)
})
