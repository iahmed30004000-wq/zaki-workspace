-- «قراءة نص الصور»: the text read out of one picture (a chat image or a library image) by the owner's own
-- vision service, kept so asking again is free and so search can find a picture by the words inside it.
-- One row per stored file (a new library version is a new file row, so it is read on its own). Additive:
-- a new table, nothing existing is touched. The row goes away with its file.

CREATE TABLE "FileText" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileText_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileText_fileId_key" ON "FileText"("fileId");

CREATE INDEX "FileText_orgId_idx" ON "FileText"("orgId");

ALTER TABLE "FileText" ADD CONSTRAINT "FileText_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
