-- C1.1 (B): the data move for "Conversation"."lastMessageAt" (the structure is the migration before this one).
-- The newest message that is NOT deleted (a system line counts, like any message). A conversation with no such message stays NULL.
-- Safe to repeat: it only fills rows that are still NULL, so a second run changes nothing and never overwrites a value the app wrote.
UPDATE "Conversation" c
SET "lastMessageAt" = m."newest"
FROM (
  SELECT "conversationId", max("createdAt") AS "newest"
  FROM "ChatMessage"
  WHERE "deletedAt" IS NULL
  GROUP BY "conversationId"
) m
WHERE m."conversationId" = c."id"
  AND c."lastMessageAt" IS NULL;
