-- Editing a sent photo or file: the replaced attachment row is KEPT (messageId becomes NULL) and remembers its message and the time of the edit. Additive: two nullable columns, an index and a foreign key.
ALTER TABLE "MessageAttachment" ADD COLUMN     "replacedAt" TIMESTAMP(3),
ADD COLUMN     "formerMessageId" TEXT;

CREATE INDEX "MessageAttachment_formerMessageId_idx" ON "MessageAttachment"("formerMessageId");

ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_formerMessageId_fkey" FOREIGN KEY ("formerMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
