import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import {
  createProcessingRuns,
  LostLeaseError,
  RESUME_VALIDATION_KIND,
  retryDelaySeconds,
  MAX_ATTEMPTS,
} from "../lib/domain/processing-run/service"
nextEnv.loadEnvConfig(process.cwd())
const db = createDatabaseClient(process.env.DATABASE_URL!)
after(() => db.$disconnect())
test("real Postgres: idempotent ensure, 20 concurrent claims, leases, retries, caps and cancellation", async () => {
  const owner = `worker-test-${randomUUID()}`
  await db.userProfile.create({ data: { id: owner } })
  const runs = createProcessingRuns(db, () => 0.5)
  try {
    const resume = await db.resume.create({
      data: { ownerUserId: owner, title: "Sanitized test" },
    })
    const upload = await db.resumeUpload.create({
      data: {
        ownerUserId: owner,
        resumeId: resume.id,
        objectKey: `test/${randomUUID()}`,
        originalFileName: "test.pdf",
        declaredContentType: "application/pdf",
        declaredSizeBytes: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const duplicates = await Promise.all(
      Array.from({ length: 20 }, () => runs.ensure(upload))
    )
    assert.equal(new Set(duplicates.map((run) => run.id)).size, 1)
    const id = duplicates[0].id
    const claims = await Promise.all(
      Array.from({ length: 20 }, () => runs.claim(RESUME_VALIDATION_KIND, id))
    )
    assert.equal(claims.filter(Boolean).length, 1)
    const old = claims.find(Boolean)!
    assert.equal(old.attempt, 1)
    await db.processingRun.update({
      where: { id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    for (const mutate of [
      () => runs.finish(old, "succeeded", null),
      () => runs.finish(old, "failed", "test"),
      () => runs.renew(old),
      () => runs.retry(old, "test"),
      () => runs.checkpoint(old, { test: true }),
    ])
      await assert.rejects(mutate(), LostLeaseError)
    const reclaimed = (await runs.claim(RESUME_VALIDATION_KIND, id))!
    assert.equal(reclaimed.attempt, 2)
    assert.notEqual(reclaimed.leaseToken, old.leaseToken)
    for (const mutate of [
      () => runs.finish(old, "succeeded", null),
      () => runs.finish(old, "failed", "test"),
      () => runs.renew(old),
      () => runs.retry(old, "test"),
      () => runs.checkpoint(old, { test: true }),
    ])
      await assert.rejects(mutate(), LostLeaseError)
    await runs.checkpoint(reclaimed, { verified: true })
    await runs.renew(reclaimed)
    await runs.retry(reclaimed, "dependency_unavailable")
    let persisted = await db.processingRun.findUniqueOrThrow({ where: { id } })
    assert.equal(persisted.status, "retry_wait")
    assert.ok(persisted.availableAt.getTime() > Date.now())
    assert.equal(await runs.claim(RESUME_VALIDATION_KIND, id), null)
    await db.processingRun.update({
      where: { id },
      data: { availableAt: new Date(Date.now() - 1000) },
    })
    const due = (await runs.claim(RESUME_VALIDATION_KIND, id))!
    await runs.finish(due, "succeeded", null)
    persisted = await db.processingRun.findUniqueOrThrow({ where: { id } })
    assert.equal(persisted.status, "succeeded")
    assert.equal(persisted.leaseToken, null)
    assert.equal(persisted.leaseExpiresAt, null)
    assert.ok(persisted.completedAt)
    assert.equal((await runs.ensure(upload)).id, id)
    assert.equal(await runs.claim(RESUME_VALIDATION_KIND, id), null)

    // Controlled fixtures only, exercising final-attempt failure and crash exhaustion.
    await db.processingRun.update({
      where: { id },
      data: {
        status: "pending",
        attempt: MAX_ATTEMPTS - 1,
        completedAt: null,
        availableAt: new Date(Date.now() - 1000),
      },
    })
    const last = (await runs.claim(RESUME_VALIDATION_KIND, id))!
    assert.equal(last.attempt, MAX_ATTEMPTS)
    await runs.retry(last, "dependency_unavailable")
    assert.equal(
      (await db.processingRun.findUniqueOrThrow({ where: { id } })).status,
      "failed"
    )
    await db.processingRun.update({
      where: { id },
      data: {
        status: "running",
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
        completedAt: null,
      },
    })
    assert.equal(await runs.claim(RESUME_VALIDATION_KIND, id), null)
    assert.equal(
      (await db.processingRun.findUniqueOrThrow({ where: { id } })).errorCode,
      "attempts_exhausted"
    )
    await db.processingRun.update({
      where: { id },
      data: {
        status: "pending",
        attempt: 0,
        completedAt: null,
        availableAt: new Date(Date.now() - 1000),
      },
    })
    const cancel = (await runs.claim(RESUME_VALIDATION_KIND, id))!
    await db.processingRun.update({
      where: { id },
      data: { cancellationRequestedAt: new Date() },
    })
    assert.equal(await runs.checkCancellation(cancel), true)
    assert.equal(
      (await db.processingRun.findUniqueOrThrow({ where: { id } })).status,
      "canceled"
    )
  } finally {
    await db.processingRun.deleteMany({ where: { ownerUserId: owner } })
    await db.resumeUpload.deleteMany({ where: { ownerUserId: owner } })
    await db.resume.deleteMany({ where: { ownerUserId: owner } })
    await db.userProfile.delete({ where: { id: owner } })
  }
})
test("retry jitter remains bounded and deterministic", () => {
  assert.equal(
    retryDelaySeconds(1, () => 0),
    22.5
  )
  assert.equal(
    retryDelaySeconds(2, () => 0.5),
    60
  )
  assert.ok(retryDelaySeconds(20, () => 1) <= 1125)
})

test("parallel generic claims enforce global and per-owner budgets", async () => {
  const owners = Array.from(
    { length: 3 },
    () => `worker-budget-test-${randomUUID()}`
  )
  const kind = `budget-test-${randomUUID()}`
  await db.userProfile.createMany({ data: owners.map((id) => ({ id })) })
  try {
    await db.processingRun.createMany({
      data: owners.flatMap((ownerUserId) =>
        Array.from({ length: 3 }, () => ({
          ownerUserId,
          kind,
          resourceId: randomUUID(),
          idempotencyKey: randomUUID(),
        }))
      ),
    })
    const runs = createProcessingRuns(db)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => runs.claim(kind))
    )
    const claimed = results.filter((run) => run !== null)
    assert.equal(claimed.length, 5)
    assert.equal(new Set(claimed.map((run) => run.id)).size, 5)
    for (const owner of owners)
      assert.ok(claimed.filter((run) => run.ownerUserId === owner).length <= 2)
  } finally {
    await db.processingRun.deleteMany({ where: { kind } })
    await db.userProfile.deleteMany({ where: { id: { in: owners } } })
  }
})
