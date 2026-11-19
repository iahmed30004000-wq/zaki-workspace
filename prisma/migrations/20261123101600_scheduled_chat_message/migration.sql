-- C3c.3: scheduled messages («جدول الإرسال»). One NEW table, ScheduledChatMessage, and its status enum (created in the same migration, so the value is usable). Additive: no existing table or column is touched.
-- A table of its own on purpose: a message dated in the future inside ChatMessage would need a "not yet" filter in every reader of messages, and one forgotten filter is a leak.

-- CreateEnum
CREATE TYPE "ScheduledChatStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ScheduledChatMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentIds" JSONB NOT NULL DEFAULT '[]',
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "replyToId" TEXT,
    "silent" BOOLEAN NOT NULL DEFAULT false,
    "noPreview" BOOLEAN NOT NULL DEFAULT false,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledChatStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "failReason" TEXT,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledChatMessage_status_sendAt_idx" ON "ScheduledChatMessage"("status", "sendAt");

-- CreateIndex
CREATE INDEX "ScheduledChatMessage_conversationId_authorId_status_idx" ON "ScheduledChatMessage"("conversationId", "authorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledChatMessage_authorId_clientId_key" ON "ScheduledChatMessage"("authorId", "clientId");

-- AddForeignKey
ALTER TABLE "ScheduledChatMessage" ADD CONSTRAINT "ScheduledChatMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledChatMessage" ADD CONSTRAINT "ScheduledChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledChatMessage" ADD CONSTRAINT "ScheduledChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
