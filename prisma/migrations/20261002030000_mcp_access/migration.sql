CREATE TABLE "McpAccessToken" (
  "id" UUID NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "tokenPrefix" VARCHAR(12) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "lastUsedAt" TIMESTAMPTZ(3),
  "rateWindowAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rateCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpAccessToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpAccessToken_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "McpAccessToken_tokenHash_key" ON "McpAccessToken"("tokenHash");
CREATE INDEX "McpAccessToken_ownerUserId_createdAt_idx" ON "McpAccessToken"("ownerUserId", "createdAt");
