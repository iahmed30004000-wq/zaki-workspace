-- «القصص»: a photo or a short video a person shares with the company for 24 hours, and who saw it.
-- Additive: two new tables, nothing existing is changed.
-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryView" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_fileId_key" ON "Story"("fileId");

-- CreateIndex
CREATE INDEX "Story_orgId_expiresAt_idx" ON "Story"("orgId", "expiresAt");

-- CreateIndex
CREATE INDEX "Story_authorId_createdAt_idx" ON "Story"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryView_storyId_viewerId_key" ON "StoryView"("storyId", "viewerId");

-- CreateIndex
CREATE INDEX "StoryView_viewerId_idx" ON "StoryView"("viewerId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
