-- «لازم ينقرأ» (Q1.6): additive columns on ChatMessage
ALTER TABLE "ChatMessage" ADD COLUMN "ackRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ackMeta" JSONB;
