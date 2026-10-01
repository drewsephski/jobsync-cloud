-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "preferenceRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "confirmedVersionId" UUID;

-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN     "originDraftId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Resume_confirmedVersionId_key" ON "Resume"("confirmedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_ownerUserId_resumeId_id_key" ON "ResumeVersion"("ownerUserId", "resumeId", "id");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_ownerUserId_id_confirmedVersionId_fkey" FOREIGN KEY ("ownerUserId", "id", "confirmedVersionId") REFERENCES "ResumeVersion"("ownerUserId", "resumeId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_ownerUserId_resumeId_originDraftId_fkey" FOREIGN KEY ("ownerUserId", "resumeId", "originDraftId") REFERENCES "ResumeVersion"("ownerUserId", "resumeId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Consent is paired and is independent of processing/readiness status.
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_confirmation_pair_check"
  CHECK (("confirmedVersionId" IS NULL) = ("confirmedAt" IS NULL));
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_preferenceRevision_check"
  CHECK ("preferenceRevision" >= 0);
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_edit_origin_check"
  CHECK ("originDraftId" IS NULL OR (source = 'manual' AND "originDraftId" <> id));
