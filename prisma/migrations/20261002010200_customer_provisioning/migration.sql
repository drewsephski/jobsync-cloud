-- Commit a stable provisioning identity before an external Stripe operation.
ALTER TABLE "BillingCustomer" ALTER COLUMN "stripeCustomerId" DROP NOT NULL;
ALTER TABLE "UserProfile" ADD CONSTRAINT "trial_window_valid" CHECK (
  ("trialStartedAt" IS NULL AND "trialEndsAt" IS NULL) OR
  ("trialStartedAt" IS NOT NULL AND "trialEndsAt" IS NOT NULL AND "trialEndsAt" > "trialStartedAt")
);
ALTER TABLE "DiscoveryAllowance" ADD CONSTRAINT "discovery_scans_nonnegative" CHECK (scans >= 0);
