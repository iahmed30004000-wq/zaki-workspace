-- «نتفرّج سوا» «حوّل»: an idea or a project made from a comment of a watch session keeps the comment it came from, so the
-- comment can show what it became (a task already does: Task.sourceMessageId). Additive only: two nullable columns, their
-- indexes and foreign keys (SET NULL: deleting the comment never deletes the idea or the project).

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN "sourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "sourceMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Idea_sourceMessageId_idx" ON "Idea"("sourceMessageId");

-- CreateIndex
CREATE INDEX "Project_sourceMessageId_idx" ON "Project"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
