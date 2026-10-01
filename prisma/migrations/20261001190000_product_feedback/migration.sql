CREATE TABLE "ProductFeedback" (
  "id" UUID NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "submissionKey" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "message" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductFeedback_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductFeedback_ownerUserId_submissionKey_key" ON "ProductFeedback"("ownerUserId", "submissionKey");
CREATE INDEX "ProductFeedback_ownerUserId_createdAt_idx" ON "ProductFeedback"("ownerUserId", "createdAt");
