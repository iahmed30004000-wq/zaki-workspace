-- «الرد في محادثة أخرى»: a reply that quotes a message of another conversation. Additive: two nullable columns, an index and a foreign key (SET NULL: a source that is gone leaves the reply, without its quote).
ALTER TABLE "ChatMessage" ADD COLUMN     "crossReplyToId" TEXT,
ADD COLUMN     "crossReply" JSONB;

CREATE INDEX "ChatMessage_crossReplyToId_idx" ON "ChatMessage"("crossReplyToId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_crossReplyToId_fkey" FOREIGN KEY ("crossReplyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
