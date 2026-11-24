-- «بوت فاذر»: one table of bots. Additive only: nothing is moved or dropped.
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "commands" JSONB,
    "webhookUrl" TEXT,
    "webhookSecretCipher" TEXT,
    "tokenId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Bot_userId_key" ON "Bot"("userId");
CREATE UNIQUE INDEX "Bot_orgId_username_key" ON "Bot"("orgId", "username");
CREATE INDEX "Bot_orgId_deletedAt_idx" ON "Bot"("orgId", "deletedAt");
