-- C1.1 (C): the index of the message cursor (createdAt, id) inside one conversation (F0.8): "the 50 before this message" is one index range.
-- Additive. ChatMessage is the biggest table: the build takes a write lock on it while it runs (a plain CREATE INDEX; Prisma runs a migration in a
-- transaction, where CONCURRENTLY is not allowed), so deploy this one in a quiet moment. The older index ("conversationId", "createdAt") stays.
CREATE INDEX "ChatMessage_conversationId_createdAt_id_idx" ON "ChatMessage"("conversationId", "createdAt", "id");
