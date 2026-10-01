import { createHash } from "node:crypto"
import type {
  JobPosting,
  TargetPreference,
} from "../../generated/prisma/client"
import type { ResumeContent } from "../onboarding/schema"
export const ALGORITHM_VERSION = "discovery-lexical-v2:match-lean-v1"
export const MAX_AI_PER_USER_DAY = 3
export const MAX_FEED_CANDIDATES = 50
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const aliases: Record<string, string> = {
  developer: "engineer",
  engineering: "engineer",
  design: "designer",
  frontend: "front end",
  backend: "back end",
  sr: "senior",
  jr: "junior",
  sde: "software engineer",
}
const stop = new Set([
  "a",
  "an",
  "and",
  "of",
  "the",
  "in",
  "at",
  "for",
  "to",
  "with",
  "job",
  "role",
])
export function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .flatMap((t) => (aliases[t] ?? t).split(" "))
    .filter((t) => t && !stop.has(t))
}
// Superset of the lexical ranker's title eligibility. Provider spellings must
// not be lost before aliases/word boundaries are evaluated by prerank.
export function titleSearchTerms(
  targets: Pick<TargetPreference, "targetTitle">[]
) {
  const terms = new Set(targets.flatMap((t) => tokens(t.targetTitle)))
  for (const [alias, expansion] of Object.entries(aliases))
    if (expansion.split(" ").some((word) => terms.has(word))) terms.add(alias)
  return [...terms].filter(
    (t) =>
      ![
        "senior",
        "junior",
        "staff",
        "principal",
        "lead",
        "manager",
        "sr",
        "jr",
      ].includes(t)
  )
}
const has = (haystack: string, needle: string) => {
  const words = tokens(haystack).join(" ")
  const term = tokens(needle).join(" ")
  return !!term && ` ${words} `.includes(` ${term} `)
}
export function preferenceFingerprint(targets: TargetPreference[]) {
  return fingerprint(
    targets
      .map((t) => ({
        title: t.targetTitle,
        location: t.location,
        remote: t.remotePreferred,
        minimum: t.minimumCompensationUsd?.toString() ?? null,
        keywords: [...t.keywords].sort(),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
}
export function prerank(
  posting: Pick<JobPosting, "title" | "location" | "remote" | "description">,
  targets: TargetPreference[],
  resume: ResumeContent
) {
  let best = { eligible: false, score: 0, reasons: [] as string[] }
  for (const target of targets) {
    // Location is an eligibility preference, never a fit-score ingredient. Unknown
    // remote status cannot satisfy an explicitly remote-only preference.
    if (target.remotePreferred === true && posting.remote !== true) continue
    const locations =
      target.location
        ?.split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean) ?? []
    if (
      locations.length &&
      posting.remote !== true &&
      !locations.some((l) => has(posting.location, l))
    )
      continue
    const wanted = [...new Set(tokens(target.targetTitle))]
    const title = new Set(tokens(posting.title))
    // Generic modifiers such as "product", "software" and "data" are not
    // enough to substitute a different occupation, even with shared skills.
    const occupation = wanted.filter((t) =>
      ["engineer", "designer", "scientist"].includes(t)
    )
    if (occupation.length && !occupation.every((t) => title.has(t))) continue
    const hit = wanted.filter((t) => title.has(t))
    const substantive = hit.filter(
      (t) =>
        !["senior", "junior", "staff", "principal", "lead", "manager"].includes(
          t
        )
    )
    if (!substantive.length || hit.length / Math.max(1, wanted.length) < 0.5)
      continue
    const text = `${posting.title} ${posting.description}`
    const skills = resume.skills.filter((s) => has(text, s)).slice(0, 8)
    const keywords = target.keywords.filter((k) => has(text, k)).slice(0, 5)
    const score = Math.min(
      100,
      Math.round((60 * hit.length) / wanted.length) +
        Math.min(25, skills.length * 5) +
        Math.min(15, keywords.length * 5)
    )
    const reasons = [
      `Title overlaps your ${target.targetTitle} target`,
      ...(skills.length
        ? [`Resume skills mentioned: ${skills.join(", ")}`]
        : []),
      ...(keywords.length
        ? [`Preferred keywords: ${keywords.join(", ")}`]
        : []),
    ]
    if (score >= 45 && score > best.score)
      best = { eligible: true, score, reasons }
  }
  return best
}
