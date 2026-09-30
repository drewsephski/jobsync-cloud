-- Preserve actual metadata for rejected objects up to Neon's 5 GiB object limit.
-- Declared/accepted resume sizes remain limited to 5 MiB by existing checks.
ALTER TABLE "ResumeUpload" ALTER COLUMN "actualSizeBytes" TYPE BIGINT;
