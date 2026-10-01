import { randomUUID } from "node:crypto"
import type {
  Prisma,
  PrismaClient,
  ProcessingRun,
} from "../../generated/prisma/client"
import type { AiReceipt, StructureResult } from "../../ai/openrouter"
import { RESUME_AI_CONFIG } from "../../ai/config"
import { LostLeaseError } from "../processing-run/service"
export class AllowanceError extends Error {
  constructor(public code: string) {
    super(code)
  }
}
export async function lockLiveRun(
  tx: Prisma.TransactionClient,
  run: ProcessingRun
) {
  const rows = await tx.$queryRaw<ProcessingRun[]>`SELECT * FROM "ProcessingRun"
    WHERE "id" = ${run.id}::uuid AND "ownerUserId" IS NOT DISTINCT FROM ${run.ownerUserId}
      AND "leaseToken" = ${run.leaseToken}::uuid AND "status" = 'running'
      AND "leaseExpiresAt" > clock_timestamp() AND "cancellationRequestedAt" IS NULL FOR UPDATE`
  if (!rows[0]) throw new LostLeaseError()
}
export function receiptData(receipt: AiReceipt) {
  return {
    model: receipt.model,
    providerRequestId: receipt.providerRequestId,
    inputTokens: receipt.inputTokens,
    outputTokens: receipt.outputTokens,
    costMicroUsd: receipt.costMicroUsd,
    metadata: {
      actualProvider: receipt.provider,
      actualCostUsd: receipt.actualCostUsd ?? null,
      totalTokens: receipt.totalTokens,
      reasoningTokens: receipt.reasoningTokens,
      cachedTokens: receipt.cachedTokens,
      latencyMs: receipt.latencyMs,
      finishReason: receipt.finishReason,
      zdr: true,
      dataCollection: "deny",
    } satisfies Prisma.InputJsonObject,
  }
}
export function createAiAccounting(
  db: PrismaClient,
  config = RESUME_AI_CONFIG as {
    model: string
    maxPaidAttempts: number
    reservedCostMicroUsd: bigint
    pricingVersion: string
  },
  feature = "resume_structure_v1",
  policyId = "resume"
) {
  async function reserve(run: ProcessingRun) {
    return db.$transaction(
      async (tx) => {
        await lockLiveRun(tx, run)
        // All invocations serialize admission; no read/check/write allowance race.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234102)`
        const policy = await tx.aiBudgetPolicy.findUnique({
          where: { id: policyId },
        })
        if (!policy?.enabled) throw new AllowanceError("ai_paused")
        const existing = await tx.aiUsageReservation.findUnique({
          where: { idempotencyKey: run.idempotencyKey },
        })
        if (existing) {
          if (existing.ownerUserId !== run.ownerUserId)
            throw new Error("reservation_owner_conflict")
          return existing
        }
        const [totals] = await tx.$queryRaw<
          { units: bigint; ownerCost: bigint; globalCost: bigint }[]
        >`
        SELECT COALESCE(sum(COALESCE("consumedUnits", "reservedUnits")) FILTER (
          WHERE "ownerUserId" = ${run.ownerUserId} AND "billingPeriodEnd" > now()),0)::bigint AS units,
        COALESCE(sum(COALESCE("finalCostMicroUsd", "reservedCostMicroUsd")) FILTER (
          WHERE "ownerUserId" = ${run.ownerUserId} AND ("billingPeriodEnd" > now() OR "finalCostMicroUsd" IS NULL)),0)::bigint AS "ownerCost",
        COALESCE(sum(COALESCE("finalCostMicroUsd", "reservedCostMicroUsd")) FILTER (
          WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' OR "finalCostMicroUsd" IS NULL),0)::bigint AS "globalCost"
        FROM "AiUsageReservation" WHERE status <> 'released'
      `
        const cost =
          config.reservedCostMicroUsd * BigInt(config.maxPaidAttempts)
        if (
          totals.units + BigInt(1) > policy.ownerMonthlyUnits ||
          totals.ownerCost + cost > policy.ownerMonthlyCostMicroUsd
        )
          throw new AllowanceError("allowance_exhausted")
        if (totals.globalCost + cost > policy.globalDailyCostMicroUsd)
          throw new AllowanceError("ai_spend_limit")
        const [period] = await tx.$queryRaw<
          { start: Date; end: Date }[]
        >`SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start, (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC' AS end`
        return tx.aiUsageReservation.create({
          data: {
            ownerUserId: run.ownerUserId!,
            feature,
            provider: "openrouter",
            model: config.model,
            idempotencyKey: run.idempotencyKey,
            reservedUnits: BigInt(1),
            reservedCostMicroUsd: cost,
            billingPeriodStart: period.start,
            billingPeriodEnd: period.end,
            expiresAt: new Date(Date.now() + 120_000),
          },
        })
      },
      { maxWait: 10_000, timeout: 30_000 }
    )
  }
  async function begin(run: ProcessingRun, reservationId: string) {
    return db.$transaction(
      async (tx) => {
        await lockLiveRun(tx, run)
        await tx.$queryRaw`SELECT id FROM "AiUsageReservation" WHERE id = ${reservationId}::uuid FOR UPDATE`
        const reservation = await tx.aiUsageReservation.findFirstOrThrow({
          where: { id: reservationId, ownerUserId: run.ownerUserId! },
        })
        const policy = await tx.aiBudgetPolicy.findUnique({
          where: { id: policyId },
        })
        if (!policy?.enabled) throw new AllowanceError("ai_paused")
        if (feature === "job_match_v1") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(78234102)`
          const [daily] = await tx.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM "AiUsage" WHERE "ownerUserId"=${run.ownerUserId} AND feature=${feature}
            AND "createdAt" >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
          if (Number(daily.count) >= 3)
            throw new AllowanceError("daily_match_limit")
        }
        const prior = await tx.aiUsage.findMany({
          where: { reservationId },
          orderBy: { createdAt: "asc" },
        })
        if (
          prior.some(
            (usage) =>
              usage.status !== "failed" || usage.costMicroUsd !== BigInt(0)
          )
        )
          throw new AllowanceError("provider_outcome_unknown")
        if (
          prior.length >= config.maxPaidAttempts ||
          !["reserved", "released"].includes(reservation.status)
        )
          throw new AllowanceError("ai_attempts_exhausted")
        await tx.aiUsageReservation.update({
          where: { id: reservationId },
          data: {
            status: "reconciliation_required",
            consumedUnits: null,
            finalCostMicroUsd: null,
          },
        })
        return tx.aiUsage.create({
          data: {
            ownerUserId: run.ownerUserId!,
            reservationId,
            feature,
            provider: "openrouter",
            model: config.model,
            requestId: randomUUID(),
            pricingVersion: config.pricingVersion,
            status: "reconciliation_required",
            errorCode: "request_in_flight",
            metadata: { zdr: true, dataCollection: "deny" },
          },
        })
      },
      { maxWait: 10_000, timeout: 30_000 }
    )
  }
  async function settleIn(
    tx: Prisma.TransactionClient,
    reservationId: string,
    retry = false
  ) {
    await tx.$queryRaw`SELECT id FROM "AiUsageReservation" WHERE id = ${reservationId}::uuid FOR UPDATE`
    const usage = await tx.aiUsage.findMany({ where: { reservationId } })
    const unknown = usage.some(
      (row) =>
        row.costMicroUsd === null || row.status === "reconciliation_required"
    )
    const cost = unknown
      ? null
      : usage.reduce((sum, row) => sum + row.costMicroUsd!, BigInt(0))
    const consumed = unknown
      ? null
      : usage.some(
            (row) =>
              row.status === "succeeded" ||
              row.costMicroUsd! > BigInt(0) ||
              (row.inputTokens ?? 0) > 0 ||
              (row.outputTokens ?? 0) > 0 ||
              row.providerRequestId !== null
          )
        ? BigInt(1)
        : BigInt(0)
    return tx.aiUsageReservation.update({
      where: { id: reservationId },
      data: {
        status: unknown
          ? "reconciliation_required"
          : retry
            ? "reserved"
            : consumed === BigInt(0)
              ? "released"
              : "settled",
        consumedUnits: retry ? null : consumed,
        finalCostMicroUsd: retry ? null : cost,
      },
    })
  }
  async function record(
    tx: Prisma.TransactionClient,
    requestId: string,
    result: Omit<StructureResult, "data"> & { data: unknown | null }
  ) {
    let usage = await tx.aiUsage.findUniqueOrThrow({ where: { requestId } })
    // Same reservation-before-usage lock order as billing reconciliation.
    await tx.$queryRaw`SELECT id FROM "AiUsageReservation" WHERE id = ${usage.reservationId}::uuid FOR UPDATE`
    usage = await tx.aiUsage.findUniqueOrThrow({ where: { requestId } })
    if (usage.errorCode !== "request_in_flight") return usage
    const storedUsd =
      usage.metadata &&
      typeof usage.metadata === "object" &&
      !Array.isArray(usage.metadata) &&
      typeof usage.metadata.actualCostUsd === "number"
        ? usage.metadata.actualCostUsd
        : null
    // Canonical generation billing may have arrived while output was validating.
    const receipt = result.receipt
      ? {
          ...result.receipt,
          costMicroUsd: result.receipt.costMicroUsd ?? usage.costMicroUsd,
          actualCostUsd: result.receipt.actualCostUsd ?? storedUsd,
        }
      : null
    const row = await tx.aiUsage.update({
      where: { requestId },
      data: {
        ...(receipt
          ? receiptData(receipt)
          : result.definitelyUnbilled
            ? { costMicroUsd: BigInt(0), inputTokens: 0, outputTokens: 0 }
            : {}),
        status: receipt
          ? receipt.costMicroUsd === null
            ? "reconciliation_required"
            : result.data
              ? "succeeded"
              : "failed"
          : result.definitelyUnbilled
            ? "failed"
            : "reconciliation_required",
        errorCode: result.errorCode,
      },
    })
    await settleIn(tx, usage.reservationId!, result.retryable)
    return row
  }
  async function capture(requestId: string, receipt: AiReceipt) {
    // Persist receipt as soon as the SDK exposes it, before structured validation.
    // It is still unresolved until the operation's result transaction commits.
    await db.aiUsage.updateMany({
      where: {
        requestId,
        errorCode: "request_in_flight",
        status: "reconciliation_required",
      },
      data: receiptData(receipt),
    })
  }
  return { reserve, begin, capture, record, settleIn }
}
