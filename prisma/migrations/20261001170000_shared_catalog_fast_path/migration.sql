CREATE INDEX "AtsBoard_enabled_lastSuccessAt_idx" ON "AtsBoard"("enabled", "lastSuccessAt");

-- Substring prefilter is deliberately a superset of the deterministic title
-- ranker. Keep organic catalog growth from requiring a full posting scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "JobPosting_open_title_trgm_idx" ON "JobPosting" USING GIN (title gin_trgm_ops) WHERE open;
