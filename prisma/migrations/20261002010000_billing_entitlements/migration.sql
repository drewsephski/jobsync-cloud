-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(3),
ADD COLUMN     "trialStartedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" UUID NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "checkoutAttempt" INTEGER NOT NULL DEFAULT 0,
    "checkoutSessionId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMPTZ(3),
    "reconciledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "stripeSubscriptionId" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "stripeCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "reconciledAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("stripeSubscriptionId")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL,
    "stripeCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "customerId" TEXT,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryAllowance" (
    "ownerUserId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "scans" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscoveryAllowance_pkey" PRIMARY KEY ("ownerUserId","periodStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_stripeCustomerId_key" ON "BillingCustomer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_ownerUserId_livemode_key" ON "BillingCustomer"("ownerUserId", "livemode");

-- CreateIndex
CREATE INDEX "BillingSubscription_customerId_status_idx" ON "BillingSubscription"("customerId", "status");

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BillingCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryAllowance" ADD CONSTRAINT "DiscoveryAllowance_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

