import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, test } from "node:test"
import nextEnv from "@next/env"
import type { Prisma } from "../lib/generated/prisma/client"

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")
const { db } = await import("../lib/db")
const { checkDatabaseHealth } = await import("../lib/db-health")

after(async () => db.$disconnect())

// Even an unexpectedly accepted write is rolled back before the assertion runs.
async function expectRejectedWrite(
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  expectedCode: string
) {
  const rollback = new Error("Rollback foundation test")
  let errorCode: string | undefined
  try {
    await db.$transaction(async (tx) => {
      try {
        await write(tx)
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          errorCode = String(error.code)
        }
      }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw new Error("Test transaction failed")
  }
  assert.equal(errorCode, expectedCode)
}

async function createOwners(tx: Prisma.TransactionClient) {
  const first = `foundation-test-${randomUUID()}`
  const second = `foundation-test-${randomUUID()}`
  await tx.userProfile.createMany({ data: [{ id: first }, { id: second }] })
  return { first, second }
}

test("all foundation tables are readable through the runtime adapter", async () => {
  await checkDatabaseHealth()
})

test("resume versions cannot reference another owner's resume", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first, second } = await createOwners(tx)
    const resume = await tx.resume.create({
      data: { ownerUserId: first, title: "Transactional test" },
    })
    await tx.resumeVersion.create({
      data: {
        ownerUserId: second,
        resumeId: resume.id,
        version: 1,
        source: "manual",
        data: {},
      },
    })
  }, "P2003")
})

test("resume version numbers are unique within a resume", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first } = await createOwners(tx)
    const resume = await tx.resume.create({
      data: { ownerUserId: first, title: "Transactional test" },
    })
    const data = {
      ownerUserId: first,
      resumeId: resume.id,
      version: 1,
      source: "manual" as const,
      data: {},
    }
    await tx.resumeVersion.create({ data })
    await tx.resumeVersion.create({ data })
  }, "P2002")
})

test("service-owned logical runs cannot duplicate an idempotency key", async () => {
  await expectRejectedWrite(async (tx) => {
    const data = {
      kind: "foundation-test",
      resourceId: randomUUID(),
      idempotencyKey: randomUUID(),
    }
    await tx.processingRun.create({ data })
    await tx.processingRun.create({ data })
  }, "P2002")
})

test("AI usage cannot reference another owner's reservation", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first, second } = await createOwners(tx)
    const reservation = await tx.aiUsageReservation.create({
      data: {
        ownerUserId: first,
        feature: "foundation-test",
        idempotencyKey: randomUUID(),
        reservedUnits: BigInt(1),
        reservedCostMicroUsd: BigInt(100),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await tx.aiUsage.create({
      data: {
        ownerUserId: second,
        reservationId: reservation.id,
        feature: "foundation-test",
        provider: "test",
        model: "test",
        requestId: randomUUID(),
        status: "reconciliation_required",
      },
    })
  }, "P2003")
})

test("Postgres rejects a running run without a lease", async () => {
  await expectRejectedWrite(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "ProcessingRun" ("id", "kind", "resourceId", "idempotencyKey", "status", "updatedAt")
      VALUES (${randomUUID()}::uuid, 'foundation-test', ${randomUUID()}, ${randomUUID()}, 'running', now())
    `
  }, "P2010")
})

test("Postgres rejects negative reserved cost", async () => {
  await expectRejectedWrite(async (tx) => {
    const { first } = await createOwners(tx)
    await tx.$executeRaw`
      INSERT INTO "AiUsageReservation" ("id", "ownerUserId", "feature", "idempotencyKey", "reservedUnits", "reservedCostMicroUsd", "expiresAt", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${first}, 'foundation-test', ${randomUUID()}, 1, -1, now(), now())
    `
  }, "P2010")
})
