-- The Android app as a real app (additive: one new table and one nullable column, nothing existing is touched).
-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "userAgent" TEXT;

-- CreateTable
CREATE TABLE "AppDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Android',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "AppDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppDevice_tokenHash_key" ON "AppDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AppDevice_userId_idx" ON "AppDevice"("userId");

-- AddForeignKey
ALTER TABLE "AppDevice" ADD CONSTRAINT "AppDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
