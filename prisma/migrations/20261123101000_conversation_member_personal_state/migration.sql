-- C3a.1: a person's OWN pin, archive and "mark unread" of a conversation (three columns on the row they already have; additive, nothing is rewritten).
-- The moderator's Conversation.pinnedAt / archivedAt stay as they are (for everybody); mutedUntil already exists and is reused.
ALTER TABLE "ConversationMember" ADD COLUMN "pinnedAt" TIMESTAMP(3),
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "markedUnread" BOOLEAN NOT NULL DEFAULT false;
