-- «المستندات»: the text documents of a space, with a version history.
--
-- Additive only. Two NEW tables, empty, each with its own indexes and foreign keys. Nothing that exists is renamed,
-- dropped, rewritten or constrained.

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastEditorId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sharedWithPartners" BOOLEAN NOT NULL DEFAULT false,
    "mentions" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "cause" TEXT NOT NULL DEFAULT 'EDIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_workspaceId_archivedAt_updatedAt_idx" ON "Document"("workspaceId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Document_orgId_workspaceId_idx" ON "Document"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "DocumentRevision_documentId_createdAt_idx" ON "DocumentRevision"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRevision_documentId_version_key" ON "DocumentRevision"("documentId", "version");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_lastEditorId_fkey" FOREIGN KEY ("lastEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A revision says why it was written: a plain edit, or a restore of an older version (the table is new, so the check meets no rows).
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_cause_check" CHECK ("cause" IN ('EDIT', 'RESTORE'));

-- A revision is history: it is written once and never changed. (A DELETE is left alone on purpose: removing a company
-- cascades through its documents, and that must keep working.)
CREATE OR REPLACE FUNCTION "DocumentRevision_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DocumentRevision_append_only"
  BEFORE UPDATE ON "DocumentRevision"
  FOR EACH ROW EXECUTE FUNCTION "DocumentRevision_refuse_update"();
