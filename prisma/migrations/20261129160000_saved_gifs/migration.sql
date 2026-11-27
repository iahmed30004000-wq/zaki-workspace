-- «صور متحركة» (chatGifs): one person's own library of GIFs, in one company. A row is a pointer to a StoredFile, never a copy of it and never a right to read it
-- (src/server/chat/gifs.ts judges that on every use). Additive: a new table, its indexes and its foreign keys; nothing that exists is changed.

-- CreateTable
CREATE TABLE "SavedGif" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedGif_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedGif_userId_orgId_usedAt_idx" ON "SavedGif"("userId", "orgId", "usedAt");

-- CreateIndex
CREATE INDEX "SavedGif_fileId_idx" ON "SavedGif"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedGif_userId_orgId_fileId_key" ON "SavedGif"("userId", "orgId", "fileId");

-- AddForeignKey
ALTER TABLE "SavedGif" ADD CONSTRAINT "SavedGif_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedGif" ADD CONSTRAINT "SavedGif_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedGif" ADD CONSTRAINT "SavedGif_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
