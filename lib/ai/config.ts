// One audited model boundary; no user/provider selection or fallback models.
export const RESUME_AI_CONFIG = {
  model: "openai/gpt-6-luna",
  maxOutputTokens: 6000,
  timeoutMs: 60_000,
  maxPaidAttempts: 2,
  reservedCostMicroUsd: BigInt(50_000),
  pricingVersion: "2026-09-30-luna-ceiling-v1",
  routing: {
    zdr: true,
    data_collection: "deny" as const,
    require_parameters: true,
    allow_fallbacks: false,
    only: ["azure"],
    max_price: { prompt: 0.2, completion: 1, request: 0 },
  },
} as const

export const MATCH_AI_CONFIG = {
  ...RESUME_AI_CONFIG,
  maxOutputTokens: 600,
  maxInputBytes: 60_000,
  timeoutMs: 30_000,
  maxPaidAttempts: 1,
  reservedCostMicroUsd: BigInt(15_000),
  pricingVersion: "2026-10-01-match-luna-ceiling-v1",
} as const
