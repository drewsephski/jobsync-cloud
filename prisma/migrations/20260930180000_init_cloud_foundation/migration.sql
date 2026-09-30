-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ResumeVersionSource" AS ENUM ('manual', 'upload', 'import');

-- CreateEnum
CREATE TYPE "ResumeVersionStatus" AS ENUM ('draft', 'ready', 'rejected');

-- CreateEnum
CREATE TYPE "ProcessingRunStatus" AS ENUM ('pending', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "AiUsageReservationStatus" AS ENUM ('reserved', 'settled', 'released', 'reconciliation_required');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('succeeded', 'failed', 'reconciliation_required');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "timezone" TEXT,
    "onboardingCompletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "resumeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "ResumeVersionSource" NOT NULL,
    "status" "ResumeVersionStatus" NOT NULL DEFAULT 'draft',
    "data" JSONB NOT NULL,
    "extractedText" TEXT,
    "storageObjectKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetPreference" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "location" TEXT,
    "remotePreferred" BOOLEAN,
    "minimumCompensationUsd" BIGINT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TargetPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingRun" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ProcessingRunStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "checkpoint" JSONB,
    "cancellationRequestedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageReservation" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMPTZ(3),
    "billingPeriodEnd" TIMESTAMPTZ(3),
    "reservedUnits" BIGINT NOT NULL,
    "reservedCostMicroUsd" BIGINT NOT NULL,
    "consumedUnits" BIGINT,
    "finalCostMicroUsd" BIGINT,
    "status" "AiUsageReservationStatus" NOT NULL DEFAULT 'reserved',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiUsageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "reservationId" UUID,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "pricingVersion" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "otherBillableUnits" BIGINT,
    "costMicroUsd" BIGINT,
    "status" "AiUsageStatus" NOT NULL,
    "errorCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resume_ownerUserId_createdAt_idx" ON "Resume"("ownerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_ownerUserId_id_key" ON "Resume"("ownerUserId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_storageObjectKey_key" ON "ResumeVersion"("storageObjectKey");

-- CreateIndex
CREATE INDEX "ResumeVersion_ownerUserId_resumeId_idx" ON "ResumeVersion"("ownerUserId", "resumeId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_resumeId_version_key" ON "ResumeVersion"("resumeId", "version");

-- CreateIndex
CREATE INDEX "TargetPreference_ownerUserId_active_idx" ON "TargetPreference"("ownerUserId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingRun_idempotencyKey_key" ON "ProcessingRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProcessingRun_status_availableAt_id_idx" ON "ProcessingRun"("status", "availableAt", "id");

-- CreateIndex
CREATE INDEX "ProcessingRun_status_leaseExpiresAt_id_idx" ON "ProcessingRun"("status", "leaseExpiresAt", "id");

-- CreateIndex
CREATE INDEX "ProcessingRun_ownerUserId_status_createdAt_idx" ON "ProcessingRun"("ownerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingRun_ownerUserId_kind_resourceId_idx" ON "ProcessingRun"("ownerUserId", "kind", "resourceId");

-- CreateIndex
CREATE INDEX "ProcessingRun_kind_resourceId_idx" ON "ProcessingRun"("kind", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageReservation_idempotencyKey_key" ON "AiUsageReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiUsageReservation_ownerUserId_createdAt_idx" ON "AiUsageReservation"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageReservation_ownerUserId_status_expiresAt_idx" ON "AiUsageReservation"("ownerUserId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiUsageReservation_status_expiresAt_idx" ON "AiUsageReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageReservation_ownerUserId_id_key" ON "AiUsageReservation"("ownerUserId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_requestId_key" ON "AiUsage"("requestId");

-- CreateIndex
CREATE INDEX "AiUsage_ownerUserId_createdAt_idx" ON "AiUsage"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_ownerUserId_reservationId_idx" ON "AiUsage"("ownerUserId", "reservationId");

-- CreateIndex
CREATE INDEX "AiUsage_provider_providerRequestId_idx" ON "AiUsage"("provider", "providerRequestId");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ownerUserId_resumeId_fkey" FOREIGN KEY ("ownerUserId", "resumeId") REFERENCES "Resume"("ownerUserId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TargetPreference" ADD CONSTRAINT "TargetPreference_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageReservation" ADD CONSTRAINT "AiUsageReservation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_ownerUserId_reservationId_fkey" FOREIGN KEY ("ownerUserId", "reservationId") REFERENCES "AiUsageReservation"("ownerUserId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Postgres invariants not representable in Prisma's schema language.
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_version_positive"
    CHECK ("version" > 0);

ALTER TABLE "TargetPreference" ADD CONSTRAINT "TargetPreference_compensation_nonnegative"
    CHECK ("minimumCompensationUsd" >= 0);

ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_attempt_nonnegative"
    CHECK ("attempt" >= 0);
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_lease_pair"
    CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL));
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_running_lease"
    CHECK ("status" <> 'running' OR ("leaseToken" IS NOT NULL AND "startedAt" IS NOT NULL));

ALTER TABLE "AiUsageReservation" ADD CONSTRAINT "AiUsageReservation_accounting_nonnegative"
    CHECK ("reservedUnits" >= 0 AND "reservedCostMicroUsd" >= 0
        AND ("consumedUnits" IS NULL OR "consumedUnits" >= 0)
        AND ("finalCostMicroUsd" IS NULL OR "finalCostMicroUsd" >= 0));
ALTER TABLE "AiUsageReservation" ADD CONSTRAINT "AiUsageReservation_billing_period_pair"
    CHECK (("billingPeriodStart" IS NULL AND "billingPeriodEnd" IS NULL)
        OR ("billingPeriodStart" IS NOT NULL AND "billingPeriodEnd" IS NOT NULL
            AND "billingPeriodEnd" > "billingPeriodStart"));

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_accounting_nonnegative"
    CHECK (("inputTokens" IS NULL OR "inputTokens" >= 0)
        AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
        AND ("otherBillableUnits" IS NULL OR "otherBillableUnits" >= 0)
        AND ("costMicroUsd" IS NULL OR "costMicroUsd" >= 0));
