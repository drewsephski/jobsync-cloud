CREATE TYPE "ResumeDetectedFormat" AS ENUM ('pdf', 'docx');
ALTER TABLE "ResumeUpload"
  ADD COLUMN "validationCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "detectedFormat" "ResumeDetectedFormat",
  ADD COLUMN "contentSha256" VARCHAR(64),
  ADD CONSTRAINT "ResumeUpload_validation_hash_check" CHECK (
    "contentSha256" IS NULL OR "contentSha256" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "ResumeUpload_validation_metadata_check" CHECK (
    ("contentSha256" IS NULL AND "detectedFormat" IS NULL)
    OR ("validationCompletedAt" IS NOT NULL AND "contentSha256" IS NOT NULL
      AND "detectedFormat" IS NOT NULL AND "status" = 'uploaded')
  ),
  ADD CONSTRAINT "ResumeUpload_validation_terminal_check" CHECK (
    "validationCompletedAt" IS NULL OR "status" IN ('uploaded', 'rejected')
  );
CREATE INDEX "ResumeUpload_status_validationCompletedAt_createdAt_idx"
  ON "ResumeUpload" ("status", "validationCompletedAt", "createdAt");
