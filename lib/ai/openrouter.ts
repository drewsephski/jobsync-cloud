import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { APICallError, generateText, Output } from "ai"
import { RESUME_AI_CONFIG as config } from "./config"
import {
  resumeSchema,
  RESUME_SYSTEM_PROMPT,
  validateGroundedResume,
} from "./resume-schema"
import type { StructuredResume } from "./resume-schema"
import { z } from "zod"
export type AiReceipt = {
  model: string
  provider: string | null
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  cachedTokens: number | null
  actualCostUsd?: number | null
  costMicroUsd: bigint | null
  latencyMs: number
  finishReason: string | null
}
export type StructureResult = {
  data: StructuredResume | null
  receipt: AiReceipt | null
  errorCode: string | null
  retryable: boolean
  definitelyUnbilled: boolean
}
export type ResumeStructurer = (
  text: string,
  onReceipt?: (receipt: AiReceipt) => Promise<void>
) => Promise<StructureResult>
const count = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_647)
  .nullable()
  .catch(null)
const metadataSchema = z.object({
  provider: z.string().max(100).optional(),
  usage: z
    .object({ cost: z.number().finite().nonnegative().optional() })
    .optional(),
})
export function microUsd(cost: number | undefined) {
  if (
    cost === undefined ||
    !Number.isFinite(cost) ||
    cost < 0 ||
    cost * 1e6 > Number.MAX_SAFE_INTEGER
  )
    return null
  return BigInt(Math.ceil(cost * 1e6))
}
export function createResumeStructurer(apiKey: string): ResumeStructurer {
  const generate = createStructuredGenerator(
    apiKey,
    config,
    resumeSchema,
    RESUME_SYSTEM_PROMPT,
    (value, text) => validateGroundedResume(value, JSON.parse(text).resumeText)
  )
  return (text, onReceipt) =>
    generate(JSON.stringify({ resumeText: text }), onReceipt)
}
export function createStructuredGenerator<T>(
  apiKey: string,
  settings: {
    model: string
    routing: typeof config.routing
    maxOutputTokens: number
    timeoutMs: number
  },
  schema: z.ZodType<T>,
  system: string,
  validate: (value: T, text: string) => T = (value) => value
) {
  const config = settings
  if (!apiKey) throw new Error("missing_openrouter_key")
  const router = createOpenRouter({ apiKey })
  return async (
    text: string,
    onReceipt?: (receipt: AiReceipt) => Promise<void>
  ) => {
    const started = Date.now()
    let receipt: AiReceipt | null = null
    try {
      const result = await generateText({
        model: router.chat(config.model, {
          provider: { ...config.routing, only: [...config.routing.only] },
          usage: { include: true },
          structuredOutputs: { strict: true },
        }),
        output: Output.object({ name: "resume_draft", schema }),
        system,
        prompt: text,
        maxOutputTokens: config.maxOutputTokens,
        maxRetries: 0,
        timeout: { totalMs: config.timeoutMs },
        include: { requestBody: false, responseBody: false },
        onStepEnd: async (step) => {
          const parsed = metadataSchema.safeParse(
            step.providerMetadata?.openrouter
          )
          const metadata = parsed.success ? parsed.data : undefined
          receipt = {
            model: step.response.modelId ?? config.model,
            provider: metadata?.provider ?? null,
            providerRequestId: step.response.id ?? null,
            inputTokens: count.parse(step.usage.inputTokens ?? null),
            outputTokens: count.parse(step.usage.outputTokens ?? null),
            totalTokens: count.parse(step.usage.totalTokens ?? null),
            reasoningTokens: count.parse(
              step.usage.outputTokenDetails.reasoningTokens ?? null
            ),
            cachedTokens: count.parse(
              step.usage.inputTokenDetails.cacheReadTokens ?? null
            ),
            actualCostUsd: metadata?.usage?.cost ?? null,
            costMicroUsd: microUsd(metadata?.usage?.cost),
            latencyMs: Date.now() - started,
            finishReason: step.finishReason,
          }
          await onReceipt?.(receipt)
        },
      })
      const data = validate(result.output, text)
      return {
        data,
        receipt,
        errorCode: null,
        retryable: false,
        definitelyUnbilled: false,
      }
    } catch (error) {
      // Never copy exception text, body, prompts, response or telemetry to storage/logs.
      const status = APICallError.isInstance(error)
        ? error.statusCode
        : undefined
      const unbilled =
        !receipt &&
        status !== undefined &&
        [400, 401, 402, 403, 404, 422, 429].includes(status)
      return {
        data: null,
        receipt,
        errorCode: receipt
          ? "invalid_model_output"
          : unbilled
            ? status === 429
              ? "provider_rate_limited"
              : "provider_rejected"
            : "provider_outcome_unknown",
        retryable: unbilled && status === 429,
        definitelyUnbilled: unbilled,
      }
    }
  }
}
// Read-only billing reconciliation. A missing generation is NOT evidence of zero.
export async function fetchGenerationReceipt(
  apiKey: string,
  id: string
): Promise<AiReceipt | null> {
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      }
    )
    if (!response.ok) return null
    const parsed = z
      .object({
        data: z.object({
          id: z.string(),
          model: z.string().max(200),
          provider_name: z.string().max(100),
          total_cost: z.number().finite().nonnegative(),
          native_tokens_prompt: count,
          native_tokens_completion: count,
          generation_time: z.number().nonnegative().optional(),
          finish_reason: z.string().min(1).max(100),
          native_tokens_reasoning: count.optional(),
          native_tokens_cached: count.optional(),
        }),
      })
      .safeParse(await response.json())
    if (!parsed.success || parsed.data.data.id !== id) return null
    const value = parsed.data.data
    return {
      model: value.model,
      provider: value.provider_name,
      providerRequestId: id,
      inputTokens: value.native_tokens_prompt,
      outputTokens: value.native_tokens_completion,
      totalTokens:
        value.native_tokens_prompt !== null &&
        value.native_tokens_completion !== null
          ? value.native_tokens_prompt + value.native_tokens_completion
          : null,
      reasoningTokens: value.native_tokens_reasoning ?? null,
      cachedTokens: value.native_tokens_cached ?? null,
      actualCostUsd: value.total_cost,
      costMicroUsd: microUsd(value.total_cost),
      latencyMs: value.generation_time ?? 0,
      finishReason: value.finish_reason,
    }
  } catch {
    return null
  }
}
