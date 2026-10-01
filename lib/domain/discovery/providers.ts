import { isIP } from "node:net"
import { fingerprint } from "./relevance"

export type DiscoveryProvider = "greenhouse" | "lever" | "ashby"

export type CanonicalJob = {
  externalId: string
  title: string
  location: string
  remote: boolean | null
  description: string
  originalUrl: string
  publishedAt: Date | null
  contentHash: string
}

export type DiscoveryBoard = {
  provider: DiscoveryProvider
  slug: string
  region: string
}

type Fetcher = typeof fetch

const REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
const MAX_JOBS = 3_000
const DESCRIPTION_LIMIT = 16_000
const LEVER_PAGE_SIZE = 100
const LEVER_MAX_PAGES = 30
const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid ${label} in provider response`)
  }
  return value.trim()
}

function providerId(
  value: unknown,
  label: string,
  allowNumber = false
): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (allowNumber && typeof value === "number" && Number.isSafeInteger(value))
    return String(value)
  throw new Error(`Invalid ${label} in provider response`)
}

function optionalString(value: unknown, label: string): string {
  if (value == null) return ""
  return string(value, label, true)
}

function optionalBoolean(value: unknown, label: string): boolean | null {
  if (value == null) return null
  if (typeof value !== "boolean")
    throw new Error(`Invalid ${label} in provider response`)
  return value
}

function workplaceRemote(
  value: unknown,
  provider: "lever" | "ashby"
): boolean | null {
  if (value == null || value === "unspecified") return null
  if (provider === "lever") {
    if (value === "remote") return true
    if (value === "on-site" || value === "onsite" || value === "hybrid")
      return false
  } else {
    if (value === "Remote") return true
    if (value === "OnSite" || value === "Hybrid") return false
  }
  throw new Error(`Invalid ${provider} workplace type in provider response`)
}

function parseDate(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null
  if (typeof value !== "string")
    throw new Error(`Invalid ${label} in provider response`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()))
    throw new Error(`Invalid ${label} in provider response`)
  return date
}

function isPublicIpv4(host: string): boolean {
  const parts = host.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false
  const [a, b, c] = parts
  if (a === undefined || b === undefined || c === undefined) return false
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 &&
      (b === 168 ||
        (b === 0 && c === 0) ||
        (b === 0 && c === 2) ||
        (b === 88 && c === 99) ||
        (b === 168 && c === 0))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  const ipVersion = isIP(host)
  if (ipVersion === 4) return isPublicIpv4(host)
  if (ipVersion === 6) {
    // Treat mapped/compatible, local, transition and documentation ranges as non-public.
    return !(
      host.startsWith("::") ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("ff") ||
      host.startsWith("2002:") ||
      host.startsWith("2001:db8:")
    )
  }
  if (!host.includes(".") || host.length > 253) return false
  if (
    ["localhost", "local", "internal", "test", "example", "invalid"].some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    )
  )
    return false
  return host
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    )
}

function safePostingUrl(value: unknown): string {
  const raw = string(value, "posting URL")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Invalid posting URL in provider response")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !isPublicHostname(url.hostname.replace(/^\[|\]$/g, ""))
  ) {
    throw new Error("Unsupported posting URL in provider response")
  }
  return url.toString()
}

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
}

function decodeEntities(value: string): string {
  let decoded = value
  // Greenhouse sometimes returns HTML that has been escaped more than once.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(
      /&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,
      (entity, name: string) => {
        if (name[0] === "#") {
          const hex = name[1]?.toLowerCase() === "x"
          const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
          if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return " "
          try {
            return String.fromCodePoint(code)
          } catch {
            return " "
          }
        }
        return namedEntities[name.toLowerCase()] ?? entity
      }
    )
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

function htmlToText(value: string): string {
  const decoded = decodeEntities(value)
  return decoded
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " "
    )
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\r\f ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function boundedDescription(value: string): string {
  const clean = value.replace(/\u0000/g, "").trim()
  return clean.length > DESCRIPTION_LIMIT
    ? clean.slice(0, DESCRIPTION_LIMIT)
    : clean
}

function setContentHash(job: Omit<CanonicalJob, "contentHash">): CanonicalJob {
  if (
    job.title.length > 500 ||
    job.location.length > 3000 ||
    job.externalId.length > 200 ||
    job.originalUrl.length > 4096
  )
    throw new Error("Oversized canonical job field")
  return {
    ...job,
    contentHash: fingerprint({
      ...job,
      publishedAt: job.publishedAt?.toISOString() ?? null,
    }),
  }
}

function records(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value) || value.length > MAX_JOBS) {
    throw new Error(`Invalid or oversized ${label} provider response`)
  }
  return value.map((row) => object(row, label))
}

function greenhouseJobs(payload: unknown): CanonicalJob[] {
  const root = object(payload, "Greenhouse")
  const jobs = records(root.jobs, "Greenhouse jobs")
  if (!root.meta || typeof root.meta !== "object" || Array.isArray(root.meta)) {
    throw new Error("Invalid Greenhouse metadata")
  }
  const meta = root.meta as JsonObject
  if (!Number.isSafeInteger(meta.total) || meta.total !== jobs.length) {
    throw new Error("Incomplete Greenhouse snapshot")
  }
  return jobs.map((row) => {
    const location =
      row.location == null ? {} : object(row.location, "Greenhouse location")
    const content = optionalString(row.content, "Greenhouse content")
    const title = string(row.title, "Greenhouse title")
    return setContentHash({
      externalId: providerId(row.id, "Greenhouse job ID", true),
      title,
      location: optionalString(location.name, "Greenhouse location name"),
      remote: null,
      description: boundedDescription(htmlToText(content)),
      originalUrl: safePostingUrl(row.absolute_url),
      publishedAt: parseDate(row.first_published, "Greenhouse first_published"),
    })
  })
}

function leverJobs(pages: unknown[][], slug: string): CanonicalJob[] {
  const jobs: CanonicalJob[] = []
  for (const page of pages) {
    for (const rawRow of records(page, "Lever jobs")) {
      const categories =
        rawRow.categories == null
          ? {}
          : object(rawRow.categories, "Lever categories")
      const lists = rawRow.lists == null ? [] : rawRow.lists
      if (!Array.isArray(lists))
        throw new Error("Invalid Lever lists in provider response")
      const listText = lists
        .map((item) => {
          const list = object(item, "Lever list")
          return `${optionalString(list.text, "Lever list title")} ${htmlToText(optionalString(list.content, "Lever list content"))}`
        })
        .join("\n")
      const description = [
        optionalString(rawRow.descriptionPlain, "Lever description"),
        listText,
        optionalString(rawRow.additionalPlain, "Lever footer"),
      ]
        .filter(Boolean)
        .join("\n\n")
      const externalId = string(rawRow.id, "Lever job ID")
      const hostedUrl =
        rawRow.hostedUrl ?? `https://jobs.lever.co/${slug}/${externalId}`
      jobs.push(
        setContentHash({
          externalId,
          title: string(rawRow.text, "Lever title"),
          location: optionalString(categories.location, "Lever location"),
          remote: workplaceRemote(rawRow.workplaceType, "lever"),
          description: boundedDescription(description),
          originalUrl: safePostingUrl(hostedUrl),
          // `createdAt` is not documented as a publication date by Lever.
          publishedAt: null,
        })
      )
    }
  }
  return jobs
}

function ashbyJobs(payload: unknown): CanonicalJob[] {
  const root = object(payload, "Ashby")
  const jobs = records(root.jobs, "Ashby jobs")
  if (root.apiVersion !== "1") throw new Error("Unsupported Ashby API version")
  return jobs
    .filter((row) => {
      if (typeof row.isListed !== "boolean")
        throw new Error("Invalid Ashby isListed in provider response")
      return row.isListed
    })
    .map((row) => {
      const primaryLocation = optionalString(row.location, "Ashby location")
      const secondary =
        row.secondaryLocations == null ? [] : row.secondaryLocations
      if (!Array.isArray(secondary))
        throw new Error(
          "Invalid Ashby secondary locations in provider response"
        )
      const secondaryLocations = secondary.map((item) =>
        optionalString(
          object(item, "Ashby secondary location").location,
          "Ashby secondary location name"
        )
      )
      const locations = [primaryLocation, ...secondaryLocations].filter(Boolean)
      const remoteFromWorkplace = workplaceRemote(row.workplaceType, "ashby")
      return setContentHash({
        externalId: string(row.id, "Ashby job ID"),
        title: string(row.title, "Ashby title"),
        location: locations.join("; "),
        remote:
          row.isRemote == null
            ? remoteFromWorkplace
            : optionalBoolean(row.isRemote, "Ashby isRemote"),
        description: boundedDescription(
          optionalString(row.descriptionPlain, "Ashby description") ||
            htmlToText(
              optionalString(row.descriptionHtml, "Ashby descriptionHtml")
            )
        ),
        originalUrl: safePostingUrl(row.jobUrl),
        publishedAt: parseDate(row.publishedAt, "Ashby publishedAt"),
      })
    })
}

async function readJsonBounded(
  response: Response,
  bytesRead: { value: number }
): Promise<unknown> {
  if (!response.ok)
    throw new Error(`ATS provider returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error("ATS provider returned an empty response body")
  const chunks: Uint8Array[] = []
  let localBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      localBytes += value.byteLength
      bytesRead.value += value.byteLength
      if (
        localBytes > MAX_RESPONSE_BYTES ||
        bytesRead.value > MAX_RESPONSE_BYTES
      ) {
        await reader.cancel()
        throw new Error(
          "ATS provider response exceeded the ingestion byte limit"
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown
  } catch {
    throw new Error("ATS provider returned invalid JSON")
  }
}

async function requestJson(
  url: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  bytesRead: { value: number }
) {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    signal,
    headers: { accept: "application/json" },
  })
  return readJsonBounded(response, bytesRead)
}

function deduplicate(jobs: CanonicalJob[]): CanonicalJob[] {
  if (jobs.length > MAX_JOBS)
    throw new Error("ATS provider returned too many jobs")
  const byId = new Map<string, CanonicalJob>()
  for (const job of jobs) {
    const previous = byId.get(job.externalId)
    if (!previous) {
      byId.set(job.externalId, job)
    } else if (previous.contentHash !== job.contentHash) {
      throw new Error("ATS provider returned conflicting duplicate job IDs")
    }
  }
  return [...byId.values()]
}

export async function fetchBoard(
  board: DiscoveryBoard,
  fetcher: Fetcher = fetch
): Promise<CanonicalJob[]> {
  if (!board || !["greenhouse", "lever", "ashby"].includes(board.provider))
    throw new Error("Unsupported ATS provider")
  if (!SLUG_PATTERN.test(board.slug)) throw new Error("Invalid ATS board slug")
  if (board.region !== "global" && board.region !== "eu")
    throw new Error("Unsupported ATS board region")

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error("ATS provider request timed out")),
    REQUEST_TIMEOUT_MS
  )
  const bytesRead = { value: 0 }
  try {
    let jobs: CanonicalJob[]
    if (board.provider === "greenhouse") {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`
      jobs = greenhouseJobs(
        await requestJson(url, fetcher, controller.signal, bytesRead)
      )
    } else if (board.provider === "ashby") {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=false`
      jobs = ashbyJobs(
        await requestJson(url, fetcher, controller.signal, bytesRead)
      )
    } else {
      const host =
        board.region === "eu"
          ? "https://api.eu.lever.co"
          : "https://api.lever.co"
      const pages: unknown[][] = []
      const seenIds = new Set<string>()
      let totalRows = 0
      let finished = false
      for (let pageNumber = 0; pageNumber < LEVER_MAX_PAGES; pageNumber += 1) {
        const skip = pageNumber * LEVER_PAGE_SIZE
        const url = `${host}/v0/postings/${encodeURIComponent(board.slug)}?mode=json&skip=${skip}&limit=${LEVER_PAGE_SIZE}`
        const page = await requestJson(
          url,
          fetcher,
          controller.signal,
          bytesRead
        )
        if (!Array.isArray(page) || page.length > LEVER_PAGE_SIZE)
          throw new Error("Invalid Lever page response")
        const rows = records(page, "Lever jobs")
        totalRows += rows.length
        if (totalRows > MAX_JOBS)
          throw new Error("Lever board exceeded the job limit")
        for (const row of rows) {
          const id = string(row.id, "Lever job ID")
          if (seenIds.has(id))
            throw new Error("Lever pagination repeated a job ID")
          seenIds.add(id)
        }
        pages.push(page)
        if (page.length < LEVER_PAGE_SIZE) {
          finished = true
          break
        }
      }
      if (!finished)
        throw new Error("Lever board exceeded the pagination limit")
      jobs = leverJobs(pages, board.slug)
    }
    return deduplicate(jobs)
  } finally {
    clearTimeout(timeout)
  }
}
