-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ApplicationEventKind" AS ENUM ('created', 'transition', 'archived', 'restored');

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "jobPostingId" UUID,
    "sourcePostingKey" UUID,
    "creationKey" UUID NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "company" VARCHAR(200) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "location" VARCHAR(300) NOT NULL,
    "postingUrl" VARCHAR(2000),
    "salary" VARCHAR(200),
    "notes" VARCHAR(10000),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'saved',
    "stageName" VARCHAR(120),
    "appliedOn" DATE,
    "followUpOn" DATE,
    "nextAction" VARCHAR(300),
    "resumeId" UUID,
    "resumeVersionId" UUID,
    "resumeSnapshot" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "applicationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "ApplicationEventKind" NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "stageName" VARCHAR(120),
    "occurredOn" DATE NOT NULL,
    "note" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_ownerUserId_archivedAt_status_updatedAt_idx" ON "Application"("ownerUserId", "archivedAt", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Application_ownerUserId_followUpOn_idx" ON "Application"("ownerUserId", "followUpOn");

-- CreateIndex
CREATE UNIQUE INDEX "Application_ownerUserId_id_key" ON "Application"("ownerUserId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Application_ownerUserId_sourcePostingKey_key" ON "Application"("ownerUserId", "sourcePostingKey");

-- CreateIndex
CREATE UNIQUE INDEX "Application_ownerUserId_creationKey_key" ON "Application"("ownerUserId", "creationKey");

-- CreateIndex
CREATE INDEX "ApplicationEvent_ownerUserId_createdAt_idx" ON "ApplicationEvent"("ownerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEvent_applicationId_revision_key" ON "ApplicationEvent"("applicationId", "revision");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_ownerUserId_resumeId_resumeVersionId_fkey" FOREIGN KEY ("ownerUserId", "resumeId", "resumeVersionId") REFERENCES "ResumeVersion"("ownerUserId", "resumeId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_ownerUserId_applicationId_fkey" FOREIGN KEY ("ownerUserId", "applicationId") REFERENCES "Application"("ownerUserId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;


ALTER TABLE "Application" ADD CONSTRAINT "application_revision_nonnegative" CHECK (revision >= 0),
  ADD CONSTRAINT "application_resume_pair" CHECK (("resumeId" IS NULL) = ("resumeVersionId" IS NULL)),
  ADD CONSTRAINT "application_identity_nonempty" CHECK (length(trim(company)) > 0 AND length(trim(title)) > 0);

CREATE FUNCTION preserve_application_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId"
    OR NEW."sourcePostingKey" IS DISTINCT FROM OLD."sourcePostingKey"
    OR NEW."creationKey" IS DISTINCT FROM OLD."creationKey"
    OR NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot" THEN
    RAISE EXCEPTION 'Application source identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER application_source_immutable BEFORE UPDATE ON "Application"
  FOR EACH ROW EXECUTE FUNCTION preserve_application_source();
CREATE FUNCTION preserve_application_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Application events are append-only';
END $$;
CREATE TRIGGER application_event_immutable BEFORE UPDATE ON "ApplicationEvent"
  FOR EACH ROW EXECUTE FUNCTION preserve_application_event();
