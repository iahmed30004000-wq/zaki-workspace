-- The door's topic name (I1.1b): a nullable column and its unique index in the SAME migration. Born NULL, and NULLs never collide, so no existing row can break the index.
ALTER TABLE "Conversation" ADD COLUMN "doorKey" TEXT;

CREATE UNIQUE INDEX "Conversation_spaceId_doorKey_key" ON "Conversation"("spaceId", "doorKey");
