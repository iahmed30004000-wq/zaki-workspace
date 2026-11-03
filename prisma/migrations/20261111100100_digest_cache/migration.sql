-- «شو فاتني؟»: the cached digest of a person (additive: a new table, nothing existing is touched).
CREATE TABLE "DigestCache" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "forDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigestCache_createdAt_idx" ON "DigestCache"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigestCache_orgId_userId_key" ON "DigestCache"("orgId", "userId");
