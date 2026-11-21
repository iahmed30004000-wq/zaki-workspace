-- S5.7: small chat parity. Additive only: one nullable column and one new table; nothing is dropped, changed or backfilled.

-- 1. «رد بالاقتباس»: the piece of the replied-to message the sender picked (NULL: an ordinary reply).
ALTER TABLE "ChatMessage" ADD COLUMN     "replyQuote" TEXT;

-- 2. «حذف عندي»: one row = one person hid one message for themselves only.
CREATE TABLE "ChatMessageHidden" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageHidden_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessageHidden_userId_idx" ON "ChatMessageHidden"("userId");

CREATE UNIQUE INDEX "ChatMessageHidden_messageId_userId_key" ON "ChatMessageHidden"("messageId", "userId");

ALTER TABLE "ChatMessageHidden" ADD CONSTRAINT "ChatMessageHidden_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessageHidden" ADD CONSTRAINT "ChatMessageHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
