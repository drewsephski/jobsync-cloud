ALTER TABLE "UserProfile" ADD COLUMN "discoveryCursor" uuid, ADD COLUMN "discoveryInputKey" text;
-- Resume/posting fingerprints are immutable private match provenance. Filling
-- analysis fields after a leased provider call must never rewrite the inputs.
CREATE FUNCTION protect_job_match_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."ownerUserId",NEW."resumeId",NEW."resumeVersionId",NEW."preferenceRevision",NEW."preferenceHash",NEW."jobPostingId",NEW."postingVersion",NEW."postingHash",NEW."algorithmVersion",NEW."inputKey",NEW.relevance,NEW.reasons)
    IS DISTINCT FROM ROW(OLD."ownerUserId",OLD."resumeId",OLD."resumeVersionId",OLD."preferenceRevision",OLD."preferenceHash",OLD."jobPostingId",OLD."postingVersion",OLD."postingHash",OLD."algorithmVersion",OLD."inputKey",OLD.relevance,OLD.reasons) THEN
    RAISE EXCEPTION 'immutable_match_inputs';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_match_inputs_immutable BEFORE UPDATE ON "JobMatch" FOR EACH ROW EXECUTE FUNCTION protect_job_match_inputs();
