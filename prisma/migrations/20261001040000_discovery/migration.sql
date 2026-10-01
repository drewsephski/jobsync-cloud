-- CreateEnum
CREATE TYPE "AtsProvider" AS ENUM ('greenhouse', 'lever', 'ashby');

-- CreateEnum
CREATE TYPE "DiscoveryState" AS ENUM ('new', 'saved', 'dismissed');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtsBoard" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "provider" "AtsProvider" NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'global',
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "nextFetchAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "fetchCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AtsBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "remote" BOOLEAN,
    "description" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "contentHash" VARCHAR(64) NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyWatch" (
    "ownerUserId" TEXT NOT NULL,
    "boardId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyWatch_pkey" PRIMARY KEY ("ownerUserId","boardId")
);

-- CreateTable
CREATE TABLE "UserJobState" (
    "ownerUserId" TEXT NOT NULL,
    "jobPostingId" UUID NOT NULL,
    "state" "DiscoveryState" NOT NULL DEFAULT 'new',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserJobState_pkey" PRIMARY KEY ("ownerUserId","jobPostingId")
);

-- CreateTable
CREATE TABLE "JobMatch" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "resumeId" UUID NOT NULL,
    "resumeVersionId" UUID NOT NULL,
    "preferenceRevision" INTEGER NOT NULL,
    "preferenceHash" VARCHAR(64) NOT NULL,
    "jobPostingId" UUID NOT NULL,
    "postingVersion" INTEGER NOT NULL,
    "postingHash" VARCHAR(64) NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "relevance" INTEGER NOT NULL,
    "reasons" TEXT[],
    "aiScore" INTEGER,
    "recommendation" TEXT,
    "rationale" TEXT,
    "aiAnalyzedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "AtsBoard_enabled_nextFetchAt_idx" ON "AtsBoard"("enabled", "nextFetchAt");

-- CreateIndex
CREATE UNIQUE INDEX "AtsBoard_provider_slug_key" ON "AtsBoard"("provider", "slug");

-- CreateIndex
CREATE INDEX "JobPosting_boardId_open_firstSeenAt_idx" ON "JobPosting"("boardId", "open", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_boardId_externalId_key" ON "JobPosting"("boardId", "externalId");

-- CreateIndex
CREATE INDEX "CompanyWatch_boardId_idx" ON "CompanyWatch"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatch_inputKey_key" ON "JobMatch"("inputKey");

-- CreateIndex
CREATE INDEX "JobMatch_ownerUserId_jobPostingId_createdAt_idx" ON "JobMatch"("ownerUserId", "jobPostingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatch_ownerUserId_id_key" ON "JobMatch"("ownerUserId", "id");

-- AddForeignKey
ALTER TABLE "AtsBoard" ADD CONSTRAINT "AtsBoard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AtsBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AtsBoard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobState" ADD CONSTRAINT "UserJobState_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobState" ADD CONSTRAINT "UserJobState_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_ownerUserId_resumeId_resumeVersionId_fkey" FOREIGN KEY ("ownerUserId", "resumeId", "resumeVersionId") REFERENCES "ResumeVersion"("ownerUserId", "resumeId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bound model identities and AI score semantics independently of application validation.
ALTER TABLE "AtsBoard" ADD CONSTRAINT "ats_board_shape" CHECK ("slug" ~ '^[a-zA-Z0-9_-]{1,120}$' AND "region" IN ('global','eu') AND "fetchCount" >= 0);
ALTER TABLE "JobPosting" ADD CONSTRAINT "job_posting_shape" CHECK ("contentVersion" > 0 AND "missingCount" >= 0 AND "contentHash" ~ '^[a-f0-9]{64}$' AND ("open" = ("closedAt" IS NULL)));
ALTER TABLE "JobMatch" ADD CONSTRAINT "job_match_shape" CHECK ("preferenceRevision" >= 0 AND "postingVersion" > 0 AND "relevance" BETWEEN 0 AND 100 AND "postingHash" ~ '^[a-f0-9]{64}$' AND "preferenceHash" ~ '^[a-f0-9]{64}$' AND
  (("aiAnalyzedAt" IS NULL AND "aiScore" IS NULL AND "recommendation" IS NULL AND "rationale" IS NULL) OR ("aiAnalyzedAt" IS NOT NULL AND "aiScore" BETWEEN 0 AND 100 AND "recommendation" IN ('strong','possible','weak') AND "rationale" IS NOT NULL)));
INSERT INTO "AiBudgetPolicy" (id,enabled,"ownerMonthlyUnits","ownerMonthlyCostMicroUsd","globalDailyCostMicroUsd","updatedAt") VALUES ('discovery',true,100,1000000,5000000,now()) ON CONFLICT (id) DO NOTHING;
