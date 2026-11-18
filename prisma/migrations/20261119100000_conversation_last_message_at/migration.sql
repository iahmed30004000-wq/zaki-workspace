-- C1.1 (A): the time of the newest message of a conversation, kept on the row so the chat list never has to look it up.
-- Additive: a nullable column (born NULL for every existing row; the next migration fills it) and an index on a column nothing reads yet.
ALTER TABLE "Conversation" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

CREATE INDEX "Conversation_orgId_lastMessageAt_idx" ON "Conversation"("orgId", "lastMessageAt");
