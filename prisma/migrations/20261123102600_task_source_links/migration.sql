-- W1.6 duplicates marked, with a way out: three nullable links, all additive.
--   CampaignItem.taskId   the task a campaign item was turned into («اعمل منه مهمة»)
--   Task.sourceTicketId   the ticket a task was made from («حوّل لمهمة»)
--   Task.sourceCardId     the card a task was made from («حوّلها لمهمة»): stored here instead of living only in the audit log
-- Every foreign key is ON DELETE SET NULL: deleting the other side never deletes a task or an item, it only clears the link.
-- No data is moved here and no unique index is added (the conversions are idempotent in the application, under a lock).

-- AlterTable
ALTER TABLE "CampaignItem" ADD COLUMN "taskId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "sourceTicketId" TEXT,
ADD COLUMN "sourceCardId" TEXT;

-- CreateIndex
CREATE INDEX "CampaignItem_taskId_idx" ON "CampaignItem"("taskId");

-- CreateIndex
CREATE INDEX "Task_sourceTicketId_idx" ON "Task"("sourceTicketId");

-- CreateIndex
CREATE INDEX "Task_sourceCardId_idx" ON "Task"("sourceCardId");

-- AddForeignKey
ALTER TABLE "CampaignItem" ADD CONSTRAINT "CampaignItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceCardId_fkey" FOREIGN KEY ("sourceCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
