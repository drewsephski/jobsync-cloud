CREATE TYPE "AccountDeletionStatus" AS ENUM ('pending', 'running', 'retry_wait', 'completed');

ALTER TABLE "UserProfile"
  ADD COLUMN "deletionRequestedAt" TIMESTAMPTZ(3);

CREATE TABLE "AccountDeletionRequest" (
  "ownerUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "status" "AccountDeletionStatus" NOT NULL DEFAULT 'pending',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "errorCode" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("ownerUserId")
);

CREATE INDEX "AccountDeletionRequest_status_availableAt_requestedAt_idx"
  ON "AccountDeletionRequest"("status", "availableAt", "requestedAt");
CREATE INDEX "AccountDeletionRequest_status_leaseExpiresAt_idx"
  ON "AccountDeletionRequest"("status", "leaseExpiresAt");

CREATE TABLE "DeletedAccountAiBudget" (
  "id" UUID PRIMARY KEY,
  "incurredAt" TIMESTAMPTZ(3) NOT NULL,
  "reservedCostMicroUsd" BIGINT NOT NULL CHECK ("reservedCostMicroUsd" >= 0),
  "finalCostMicroUsd" BIGINT CHECK ("finalCostMicroUsd" >= 0)
);
