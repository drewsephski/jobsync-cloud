-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN     "extractionVersion" TEXT,
ADD COLUMN     "processingRunId" UUID,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "schemaVersion" TEXT,
ADD COLUMN     "sourceSha256" VARCHAR(64),
ADD COLUMN     "sourceUploadId" UUID;

-- CreateTable
CREATE TABLE "AiBudgetPolicy" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ownerMonthlyUnits" BIGINT NOT NULL,
    "ownerMonthlyCostMicroUsd" BIGINT NOT NULL,
    "globalDailyCostMicroUsd" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiBudgetPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingRun_ownerUserId_id_key" ON "ProcessingRun"("ownerUserId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeUpload_ownerUserId_resumeId_id_contentSha256_key" ON "ResumeUpload"("ownerUserId", "resumeId", "id", "contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_sourceUploadId_key" ON "ResumeVersion"("sourceUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_processingRunId_key" ON "ResumeVersion"("processingRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_ownerUserId_resumeId_sourceUploadId_sourceSha_key" ON "ResumeVersion"("ownerUserId", "resumeId", "sourceUploadId", "sourceSha256");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_ownerUserId_processingRunId_key" ON "ResumeVersion"("ownerUserId", "processingRunId");

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ownerUserId_resumeId_sourceUploadId_sourceSh_fkey" FOREIGN KEY ("ownerUserId", "resumeId", "sourceUploadId", "sourceSha256") REFERENCES "ResumeUpload"("ownerUserId", "resumeId", "id", "contentSha256") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ownerUserId_processingRunId_fkey" FOREIGN KEY ("ownerUserId", "processingRunId") REFERENCES "ProcessingRun"("ownerUserId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve manual versions while requiring complete, matched provenance for AI drafts.
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ai_provenance_check" CHECK (
  ("sourceUploadId" IS NULL AND "processingRunId" IS NULL AND "sourceSha256" IS NULL
   AND "extractionVersion" IS NULL AND "promptVersion" IS NULL AND "schemaVersion" IS NULL)
  OR ("sourceUploadId" IS NOT NULL AND "processingRunId" IS NOT NULL
      AND "sourceSha256" ~ '^[0-9a-f]{64}$' AND "sourceSha256" IS NOT NULL
      AND "extractionVersion" IS NOT NULL AND "promptVersion" IS NOT NULL AND "schemaVersion" IS NOT NULL
      AND "source" = 'upload' AND "extractedText" IS NULL)
);
ALTER TABLE "AiBudgetPolicy" ADD CONSTRAINT "AiBudgetPolicy_nonnegative" CHECK (
  "ownerMonthlyUnits" >= 0 AND "ownerMonthlyCostMicroUsd" >= 0 AND "globalDailyCostMicroUsd" >= 0
);
-- Starter allowance, no public credits or subscription promise. Operators can disable instantly.
INSERT INTO "AiBudgetPolicy" VALUES ('resume', true, 10, 1000000, 5000000, now());
CREATE INDEX "AiUsageReservation_createdAt_status_idx" ON "AiUsageReservation" ("createdAt", "status");
