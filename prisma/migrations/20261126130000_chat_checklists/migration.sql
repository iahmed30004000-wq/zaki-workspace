-- C3c.1: the checklist in chat («قائمة مهام»). Two NEW tables, ChatChecklist and ChatChecklistItem. Additive: no existing table or column is touched ("ChatMessage"."kind" is free text and gains the value CHECKLIST with no change of its own).
-- Why not the tables that exist: "PollVote" holds one CHOICE per person among fixed options, a checklist item has ONE shared done-state and people add items; "TaskStep" needs a "Task", which needs a project, a board and a column (the heavy path a quick list in a chat must avoid).

-- CreateTable
CREATE TABLE "ChatChecklist" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "othersCanAdd" BOOLEAN NOT NULL DEFAULT false,
    "othersCanTick" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL,
    "addedById" TEXT NOT NULL,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChecklist_messageId_key" ON "ChatChecklist"("messageId");

-- CreateIndex
CREATE INDEX "ChatChecklistItem_checklistId_position_idx" ON "ChatChecklistItem"("checklistId", "position");

-- AddForeignKey
ALTER TABLE "ChatChecklist" ADD CONSTRAINT "ChatChecklist_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChecklistItem" ADD CONSTRAINT "ChatChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "ChatChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChecklistItem" ADD CONSTRAINT "ChatChecklistItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChecklistItem" ADD CONSTRAINT "ChatChecklistItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
