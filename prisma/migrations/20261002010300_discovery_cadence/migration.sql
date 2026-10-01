-- Spread recurring scans across the day instead of consuming both in 10 minutes.
ALTER TABLE "DiscoveryAllowance" ADD COLUMN "lastScannedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now();
