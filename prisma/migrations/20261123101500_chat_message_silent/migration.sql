-- C3c.2: send without sound. One additive column on ChatMessage: true when the sender chose «ابعت بدون صوت». Existing rows read false (an ordinary message).

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "silent" BOOLEAN NOT NULL DEFAULT false;
