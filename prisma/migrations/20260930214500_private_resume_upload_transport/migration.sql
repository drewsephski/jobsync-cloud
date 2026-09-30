-- CreateEnum
CREATE TYPE "ResumeUploadStatus" AS ENUM ('pending', 'uploaded', 'rejected', 'expired');

-- CreateTable
CREATE TABLE "ResumeUpload" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "resumeId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFileName" VARCHAR(255) NOT NULL,
    "declaredContentType" TEXT NOT NULL,
    "declaredSizeBytes" INTEGER NOT NULL,
    "actualContentType" TEXT,
    "actualSizeBytes" INTEGER,
    "etag" TEXT,
    "status" "ResumeUploadStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3),
    "rejectionCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResumeUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeUpload_objectKey_key" ON "ResumeUpload"("objectKey");

-- CreateIndex
CREATE INDEX "ResumeUpload_ownerUserId_status_createdAt_idx" ON "ResumeUpload"("ownerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeUpload_status_expiresAt_idx" ON "ResumeUpload"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ResumeUpload" ADD CONSTRAINT "ResumeUpload_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeUpload" ADD CONSTRAINT "ResumeUpload_ownerUserId_resumeId_fkey" FOREIGN KEY ("ownerUserId", "resumeId") REFERENCES "Resume"("ownerUserId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Transport invariants not represented by Prisma's schema language.
ALTER TABLE "ResumeUpload"
  ADD CONSTRAINT "ResumeUpload_declared_size_check"
    CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 5242880),
  ADD CONSTRAINT "ResumeUpload_expiry_check"
    CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "ResumeUpload_declared_type_check"
    CHECK ("declaredContentType" IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  ADD CONSTRAINT "ResumeUpload_uploaded_metadata_check"
    CHECK ("status" <> 'uploaded' OR (
      "uploadedAt" IS NOT NULL AND "actualSizeBytes" IS NOT NULL
      AND "actualSizeBytes" > 0 AND "actualSizeBytes" <= 5242880
      AND "actualSizeBytes" = "declaredSizeBytes"
      AND "actualContentType" IS NOT NULL AND "actualContentType" = "declaredContentType"
      AND "rejectionCode" IS NULL
    ));
