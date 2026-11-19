-- C3b.2: link previews. One NEW table (what the server read from a public page: nothing existing holds fetched page metadata) and one nullable
-- column on ChatMessage (the preview of its first link). Additive: no row is rewritten, NULL means "no preview".

-- CreateTable
CREATE TABLE "LinkPreview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "siteName" TEXT,
    "imageFileId" TEXT,
    "status" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkPreview_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "previewId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LinkPreview_urlHash_key" ON "LinkPreview"("urlHash");

-- CreateIndex
CREATE INDEX "LinkPreview_orgId_idx" ON "LinkPreview"("orgId");

-- CreateIndex
CREATE INDEX "ChatMessage_previewId_idx" ON "ChatMessage"("previewId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "LinkPreview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkPreview" ADD CONSTRAINT "LinkPreview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkPreview" ADD CONSTRAINT "LinkPreview_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
