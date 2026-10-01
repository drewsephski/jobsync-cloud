
-- Feature caps are now plan-owned; retain the existing operational kill switch
-- and global daily ceiling while making owner ceilings cover Plus inclusions.
UPDATE "AiBudgetPolicy" SET "ownerMonthlyUnits" = 65,
  "ownerMonthlyCostMicroUsd" = 1500000, "updatedAt" = now()
WHERE id IN ('resume', 'discovery');
