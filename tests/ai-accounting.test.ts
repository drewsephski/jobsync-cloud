import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createResumeStructureWorker } from "../lib/domain/resume-structure/worker"
import {
  createAiAccounting,
  AllowanceError,
} from "../lib/domain/resume-structure/accounting"
import {
  createProcessingRuns,
  LostLeaseError,
} from "../lib/domain/processing-run/service"
import { createResumeWorker } from "../lib/domain/processing-run/resume-worker"
import { validateResume } from "../lib/validation/resume"
import {
  resumeDocx,
  sanitizedResume,
  sanitizedText,
} from "./resume-structure-fixtures"
import type {
  AiReceipt,
  StructureResult,
  ResumeStructurer,
} from "../lib/ai/openrouter"
import { readResumeStructureStatus } from "../lib/domain/resume-structure/status"
nextEnv.loadEnvConfig(process.cwd())
assert.ok(
  new URL(process.env.DATABASE_URL!).hostname.startsWith(
    "ep-green-scene-b45djevq"
  )
)
const db = createDatabaseClient(process.env.DATABASE_URL!)
after(() => db.$disconnect())
const bytes = resumeDocx()
const validated = await validateResume(
  bytes,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
const receipt: AiReceipt = {
  model: "openai/gpt-6-luna",
  provider: "OpenAI",
  providerRequestId: "gen-sanitized",
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  reasoningTokens: 0,
  cachedTokens: 0,
  costMicroUsd: BigInt(350),
  latencyMs: 100,
  finishReason: "stop",
}
const success = (): StructureResult => ({
  data: structuredClone(sanitizedResume),
  receipt: { ...receipt },
  errorCode: null,
  retryable: false,
  definitelyUnbilled: false,
})
async function fixture(
  work: (f: {
    owner: string
    upload: Awaited<ReturnType<typeof db.resumeUpload.create>>
    worker: (
      fn: ResumeStructurer
    ) => ReturnType<typeof createResumeStructureWorker>
  }) => Promise<void>
) {
  const owner = `ai-test-${randomUUID()}`
  await db.userProfile.create({ data: { id: owner } })
  try {
    const resume = await db.resume.create({
      data: { ownerUserId: owner, title: "Sanitized" },
    })
    const upload = await db.resumeUpload.create({
      data: {
        ownerUserId: owner,
        resumeId: resume.id,
        objectKey: `test/${randomUUID()}`,
        originalFileName: "sanitized.docx",
        declaredContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        declaredSizeBytes: bytes.length,
        expiresAt: new Date(Date.now() + 60_000),
        status: "uploaded",
        actualSizeBytes: BigInt(bytes.length),
        actualContentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        uploadedAt: new Date(),
        validationCompletedAt: new Date(),
        contentSha256: validated.hash,
        detectedFormat: "docx",
      },
    })
    await work({
      owner,
      upload,
      worker: (fn) => createResumeStructureWorker(db, async () => bytes, fn),
    })
  } finally {
    await db.resumeVersion.deleteMany({ where: { ownerUserId: owner } })
    await db.aiUsage.deleteMany({ where: { ownerUserId: owner } })
    await db.aiUsageReservation.deleteMany({ where: { ownerUserId: owner } })
    await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
    await db.resumeUpload.deleteMany({ where: { ownerUserId: owner } })
    await db.resume.deleteMany({ where: { ownerUserId: owner } })
    await db.userProfile.delete({ where: { id: owner } })
  }
}
test("real pipeline: 20 replayed/concurrent workers create one draft/charge with matched provenance and owner-isolated status", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let calls = 0
    const w = worker(async (text) => {
      calls++
      // Mammoth preserves DOCX paragraph boundaries as double newlines.
      assert.equal(
        text.replace(/\s+/g, " "),
        sanitizedText.replace(/\s+/g, " ")
      )
      return success()
    })
    const ensured = await Promise.all(
      Array.from({ length: 20 }, () => w.ensure(upload))
    )
    assert.equal(new Set(ensured.map((row) => row!.id)).size, 1)
    await Promise.all(
      Array.from({ length: 20 }, () => w.process(ensured[0]!.id))
    )
    assert.equal(calls, 1)
    assert.equal(
      await db.resumeVersion.count({ where: { sourceUploadId: upload.id } }),
      1
    )
    assert.equal(await w.process(ensured[0]!.id), "not_claimed")
    const version = await db.resumeVersion.findUniqueOrThrow({
      where: { sourceUploadId: upload.id },
    })
    assert.equal(version.status, "draft")
    assert.equal(version.version, 1)
    assert.equal(version.ownerUserId, owner)
    assert.equal(version.sourceSha256, validated.hash)
    assert.equal(version.extractedText, null)
    assert.deepEqual(version.data, sanitizedResume)
    const reservation = await db.aiUsageReservation.findFirstOrThrow({
      where: { ownerUserId: owner },
    })
    assert.equal(reservation.status, "settled")
    assert.equal(reservation.consumedUnits, BigInt(1))
    assert.equal(reservation.finalCostMicroUsd, BigInt(350))
    assert.equal(
      (await readResumeStructureStatus(db, owner, upload.id)).state,
      "draft"
    )
    assert.equal(
      (await readResumeStructureStatus(db, "foreign", upload.id)).draft,
      null
    )
    await assert.rejects(
      db.resumeVersion.update({
        where: { id: version.id },
        data: { sourceSha256: "0".repeat(64) },
      })
    )
    await assert.rejects(
      db.resumeVersion.update({
        where: { id: version.id },
        data: { ownerUserId: "foreign" },
      })
    )
  }))
test("reservation races: concurrent admission never exceeds monthly allowance and duplicate reservations converge", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const w = worker(async () => success())
    const run = (await w.ensure(upload))!
    const runs = createProcessingRuns(db)
    const claimed = (await runs.claim(run.kind, run.id))!
    const accounting = createAiAccounting(db)
    const reservationResults = await Promise.allSettled(
      Array.from({ length: 20 }, () => accounting.reserve(claimed))
    )
    for (const result of reservationResults)
      if (result.status === "rejected") throw result.reason
    const reservations = reservationResults.map((result) => {
      if (result.status !== "fulfilled") throw new Error("reservation_failed")
      return result.value
    })
    assert.equal(new Set(reservations.map((row) => row.id)).size, 1)
    // Separate live operations exercise admission rather than the worker claim cap.
    const created = await db.processingRun.createManyAndReturn({
      data: Array.from({ length: 15 }, () => ({
        ownerUserId: owner,
        kind: "allowance-test",
        resourceId: randomUUID(),
        idempotencyKey: randomUUID(),
        status: "running",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
        startedAt: new Date(),
      })),
    })
    const results = await Promise.allSettled(
      created.map((row) => accounting.reserve(row))
    )
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 9)
    for (const result of results)
      if (result.status === "rejected")
        assert.equal(
          (result.reason as AllowanceError).code,
          "allowance_exhausted"
        )
    const requests = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        accounting.begin(claimed, reservations[0].id)
      )
    )
    assert.equal(requests.filter((row) => row.status === "fulfilled").length, 1)
  }))
for (const [name, result, status, cost] of [
  [
    "provider rejected",
    {
      data: null,
      receipt: null,
      errorCode: "provider_rejected",
      retryable: false,
      definitelyUnbilled: true,
    },
    "released",
    BigInt(0),
  ],
  [
    "timeout/ambiguous network",
    {
      data: null,
      receipt: null,
      errorCode: "provider_outcome_unknown",
      retryable: false,
      definitelyUnbilled: false,
    },
    "reconciliation_required",
    null,
  ],
  [
    "malformed output",
    { ...success(), data: null, errorCode: "invalid_model_output" },
    "settled",
    BigInt(350),
  ],
  [
    "missing actual cost",
    { ...success(), receipt: { ...receipt, costMicroUsd: null } },
    "reconciliation_required",
    null,
  ],
] as const)
  test(`${name}: correct durable accounting and no paid replay`, async () =>
    fixture(async ({ owner, upload, worker }) => {
      let calls = 0
      const w = worker(async () => {
        calls++
        return result as StructureResult
      })
      const run = (await w.ensure(upload))!
      await w.process(run.id)
      const reservation = await db.aiUsageReservation.findFirstOrThrow({
        where: { ownerUserId: owner },
      })
      assert.equal(reservation.status, status)
      assert.equal(reservation.finalCostMicroUsd, cost)
      await w.process(run.id)
      assert.equal(calls, 1)
      assert.equal(
        await db.resumeVersion.count({ where: { ownerUserId: owner } }),
        name === "missing actual cost" ? 1 : 0
      )
      if (name === "missing actual cost") {
        const reconciler = createResumeStructureWorker(
          db,
          async () => bytes,
          async () => success(),
          async (id) => {
            assert.equal(id, receipt.providerRequestId)
            return receipt
          }
        )
        await reconciler.recover()
        assert.equal(
          (
            await db.aiUsageReservation.findUniqueOrThrow({
              where: { id: reservation.id },
            })
          ).status,
          "settled"
        )
      }
    }))
test("explicit 429 retries once, releases each rejected attempt, then settles exactly one successful charge", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let calls = 0
    const w = worker(async () =>
      ++calls === 1
        ? {
            data: null,
            receipt: null,
            errorCode: "provider_rate_limited",
            retryable: true,
            definitelyUnbilled: true,
          }
        : success()
    )
    const run = (await w.ensure(upload))!
    assert.equal(await w.process(run.id), "retry_wait")
    await db.processingRun.update({
      where: { id: run.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    })
    assert.equal(await w.process(run.id), "succeeded")
    const reservation = await db.aiUsageReservation.findFirstOrThrow({
      where: { ownerUserId: owner },
      include: { usage: true },
    })
    assert.equal(calls, 2)
    assert.equal(reservation.usage.length, 2)
    assert.equal(reservation.finalCostMicroUsd, BigInt(350))
    assert.equal(reservation.consumedUnits, BigInt(1))
  }))
test("second 429 is terminal and returns unused allowance", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const w = worker(async () => ({
      data: null,
      receipt: null,
      errorCode: "provider_rate_limited",
      retryable: true,
      definitelyUnbilled: true,
    }))
    const run = (await w.ensure(upload))!
    await w.process(run.id)
    await db.processingRun.update({
      where: { id: run.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    })
    assert.equal(await w.process(run.id), "failed")
    assert.equal(
      (
        await db.aiUsageReservation.findFirstOrThrow({
          where: { ownerUserId: owner },
        })
      ).status,
      "released"
    )
  }))
test("crash after request marker fences replay after lease reclaim; unknown cost stays held", async () =>
  fixture(async ({ upload, worker }) => {
    let calls = 0
    const w = worker(async () => {
      calls++
      return success()
    })
    const run = (await w.ensure(upload))!
    const runs = createProcessingRuns(db)
    const claimed = (await runs.claim(run.kind, run.id))!
    const accounting = createAiAccounting(db)
    const reserved = await accounting.reserve(claimed)
    await accounting.begin(claimed, reserved.id)
    await db.processingRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    assert.equal(await w.process(run.id), "failed")
    assert.equal(calls, 0)
    assert.equal(
      (
        await db.aiUsageReservation.findUniqueOrThrow({
          where: { id: reserved.id },
        })
      ).finalCostMicroUsd,
      null
    )
    await assert.rejects(accounting.begin(claimed, reserved.id), LostLeaseError)
  }))
test("lost lease after paid success keeps receipt, never writes stale draft or sends another call", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let calls = 0
    const w = worker(async () => {
      calls++
      await db.processingRun.updateMany({
        where: { resourceId: upload.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      })
      return success()
    })
    const run = (await w.ensure(upload))!
    assert.equal(await w.process(run.id), "lost_lease")
    assert.equal(
      (
        await db.aiUsageReservation.findFirstOrThrow({
          where: { ownerUserId: owner },
        })
      ).finalCostMicroUsd,
      BigInt(350)
    )
    assert.equal(await w.process(run.id), "failed")
    assert.equal(calls, 1)
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: owner } }),
      0
    )
  }))
test("source hash mismatch and missing validation never reserve or call AI", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let calls = 0
    const w = worker(async () => {
      calls++
      return success()
    })
    const run = (await w.ensure({ ...upload, contentSha256: "0".repeat(64) }))!
    await db.resumeUpload.update({
      where: { id: upload.id },
      data: { contentSha256: "0".repeat(64) },
    })
    assert.equal(await w.process(run.id), "failed")
    assert.equal(calls, 0)
    assert.equal(
      await db.aiUsageReservation.count({ where: { ownerUserId: owner } }),
      0
    )
    await db.resumeUpload.update({
      where: { id: upload.id },
      data: {
        contentSha256: null,
        detectedFormat: null,
        validationCompletedAt: null,
      },
    })
    assert.equal(await w.ensure({ ...upload, contentSha256: null }), null)
  }))
test("invalid upload validation cannot chain to a paid request", async () =>
  fixture(async ({ owner, upload }) => {
    await db.resumeUpload.update({
      where: { id: upload.id },
      data: {
        validationCompletedAt: null,
        contentSha256: null,
        detectedFormat: null,
      },
    })
    let calls = 0
    const structuring = createResumeStructureWorker(
      db,
      async () => bytes,
      async () => {
        calls++
        return success()
      }
    )
    const storage = {
      signPut: async () => "",
      signGet: async () => "",
      head: async () => ({
        size: bytes.length,
        contentType: upload.declaredContentType,
        etag: "test",
      }),
      remove: async () => {},
    }
    const validator = createResumeWorker(
      db,
      storage,
      async () => Buffer.from("invalid"),
      validateResume,
      createProcessingRuns(db),
      structuring
    )
    assert.equal(
      (await validator.objectCreated(upload.objectKey)).status,
      "failed"
    )
    assert.equal(calls, 0)
    assert.equal(await db.aiUsage.count({ where: { ownerUserId: owner } }), 0)
  }))
test("hallucinated facts from an adapter fail closed, with actual charge retained", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const w = worker(async () => {
      const result = success()
      result.data!.skills.push("Invented skill")
      return result
    })
    assert.equal(await w.uploaded(upload), "failed")
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: owner } }),
      0
    )
    assert.equal(
      (await db.aiUsage.findFirstOrThrow({ where: { ownerUserId: owner } }))
        .errorCode,
      "invalid_model_output"
    )
  }))

test("distinct uploads of the same resume allocate concurrent semantic versions monotonically", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const second = await db.resumeUpload.create({
      data: { ...upload, id: randomUUID(), objectKey: `test/${randomUUID()}` },
    })
    const w = worker(async () => success())
    await Promise.all([w.uploaded(upload), w.uploaded(second)])
    const versions = await db.resumeVersion.findMany({
      where: { ownerUserId: owner },
      orderBy: { version: "asc" },
    })
    assert.deepEqual(
      versions.map((row) => row.version),
      [1, 2]
    )
    assert.equal(new Set(versions.map((row) => row.sourceUploadId)).size, 2)
    assert.ok(versions.every((row) => row.status === "draft"))
  }))
test("database kill switch prevents dispatch, and resumes its original state", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const policy = await db.aiBudgetPolicy.findUniqueOrThrow({
      where: { id: "resume" },
    })
    let calls = 0
    try {
      await db.aiBudgetPolicy.update({
        where: { id: "resume" },
        data: { enabled: false },
      })
      const w = worker(async () => {
        calls++
        return success()
      })
      assert.equal(await w.uploaded(upload), "failed")
      const run = await db.processingRun.findFirstOrThrow({
        where: { ownerUserId: owner },
      })
      assert.equal(run.errorCode, "ai_paused")
      assert.equal(calls, 0)
      assert.equal(
        await db.aiUsageReservation.count({ where: { ownerUserId: owner } }),
        0
      )
    } finally {
      await db.aiBudgetPolicy.update({
        where: { id: "resume" },
        data: { enabled: policy.enabled },
      })
    }
  }))
test("global spend admission includes previous-day unknown holds from other owners", async () =>
  fixture(async ({ owner, upload, worker }) =>
    fixture(async ({ owner: other }) => {
      const policy = await db.aiBudgetPolicy.findUniqueOrThrow({
        where: { id: "resume" },
      })
      await db.aiUsageReservation.create({
        data: {
          ownerUserId: other,
          feature: "test",
          idempotencyKey: randomUUID(),
          reservedUnits: BigInt(1),
          reservedCostMicroUsd: policy.globalDailyCostMicroUsd,
          status: "reconciliation_required",
          createdAt: new Date(Date.now() - 2 * 86400000),
          expiresAt: new Date(Date.now() - 86400000),
        },
      })
      let calls = 0
      const w = worker(async () => {
        calls++
        return success()
      })
      assert.equal(await w.uploaded(upload), "failed")
      assert.equal(
        (
          await db.processingRun.findFirstOrThrow({
            where: { ownerUserId: owner },
          })
        ).errorCode,
        "ai_spend_limit"
      )
      assert.equal(calls, 0)
    })
  ))
test("cancellation during a paid response preserves charge and prevents draft acceptance", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const w = worker(async (_text, onReceipt) => {
      await onReceipt?.(receipt)
      await db.processingRun.updateMany({
        where: { ownerUserId: owner },
        data: { cancellationRequestedAt: new Date() },
      })
      return success()
    })
    assert.equal(await w.uploaded(upload), "canceled")
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: owner } }),
      0
    )
    assert.equal(
      (
        await db.aiUsageReservation.findFirstOrThrow({
          where: { ownerUserId: owner },
        })
      ).finalCostMicroUsd,
      BigInt(350)
    )
  }))
test("receipt survives a crash before acceptance; generation reconciliation records billing without resubmission", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let calls = 0
    const w = worker(async () => {
      calls++
      return success()
    })
    const run = (await w.ensure(upload))!,
      runs = createProcessingRuns(db),
      accounting = createAiAccounting(db)
    const claimed = (await runs.claim(run.kind, run.id))!,
      reservation = await accounting.reserve(claimed),
      usage = await accounting.begin(claimed, reservation.id)
    await accounting.capture(usage.requestId, receipt)
    assert.equal(
      (await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } }))
        .providerRequestId,
      receipt.providerRequestId
    )
    await db.processingRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    assert.equal(await w.process(run.id), "failed")
    assert.equal(calls, 0)
    const reconciler = createResumeStructureWorker(
      db,
      async () => bytes,
      async () => success(),
      async () => receipt
    )
    await reconciler.recover()
    assert.equal(
      (
        await db.aiUsageReservation.findUniqueOrThrow({
          where: { id: reservation.id },
        })
      ).status,
      "settled"
    )
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: owner } }),
      0
    )
  }))

test("billing that arrives before output acceptance is retained rather than reset to unknown", async () =>
  fixture(async ({ owner, upload, worker }) => {
    const accounting = createAiAccounting(db)
    const w = worker(async (_text, onReceipt) => {
      await onReceipt?.({ ...receipt, costMicroUsd: null })
      const usage = await db.aiUsage.findFirstOrThrow({
        where: { ownerUserId: owner },
      })
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AiUsageReservation" WHERE id = ${usage.reservationId}::uuid FOR UPDATE`
        await tx.aiUsage.update({
          where: { id: usage.id },
          data: {
            status: "failed",
            costMicroUsd: receipt.costMicroUsd,
            metadata: { actualCostUsd: 0.00035 },
          },
        })
        await accounting.settleIn(tx, usage.reservationId!)
      })
      return { ...success(), receipt: { ...receipt, costMicroUsd: null } }
    })
    assert.equal(await w.uploaded(upload), "succeeded")
    const usage = await db.aiUsage.findFirstOrThrow({
      where: { ownerUserId: owner },
    })
    assert.equal(usage.status, "succeeded")
    assert.equal(usage.costMicroUsd, BigInt(350))
    assert.equal(
      (
        await db.aiUsageReservation.findFirstOrThrow({
          where: { ownerUserId: owner },
        })
      ).status,
      "settled"
    )
  }))
test("delayed generation reconciliation cannot overwrite a concurrently accepted usage status", async () =>
  fixture(async ({ owner, upload, worker }) => {
    let releaseProvider: () => void = () => {},
      releaseReceipt: () => void = () => {},
      generationReady: () => void = () => {}
    const providerGate = new Promise<void>((resolve) => {
        releaseProvider = resolve
      }),
      receiptGate = new Promise<void>((resolve) => {
        releaseReceipt = resolve
      }),
      ready = new Promise<void>((resolve) => {
        generationReady = resolve
      })
    let captured: () => void = () => {}
    const captureReady = new Promise<void>((resolve) => {
      captured = resolve
    })
    const w = worker(async (_text, onReceipt) => {
      await onReceipt?.(receipt)
      captured()
      await providerGate
      return success()
    })
    const operation = w.uploaded(upload)
    await captureReady
    const reconciler = createResumeStructureWorker(
      db,
      async () => bytes,
      async () => success(),
      async () => {
        generationReady()
        await receiptGate
        return receipt
      }
    )
    const reconciliation = reconciler.recover()
    await ready
    releaseProvider()
    assert.equal(await operation, "succeeded")
    releaseReceipt()
    await reconciliation
    const usage = await db.aiUsage.findFirstOrThrow({
      where: { ownerUserId: owner },
    })
    assert.equal(usage.status, "succeeded")
    assert.equal(usage.costMicroUsd, BigInt(350))
    assert.equal(
      await db.resumeVersion.count({ where: { ownerUserId: owner } }),
      1
    )
  }))
