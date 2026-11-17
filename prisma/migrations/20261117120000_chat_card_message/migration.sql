-- «/» في صندوق الكتابة (Q1.3): the CARD message kind (additive: two nullable columns). `card` holds only what the message points at, never a price.
ALTER TABLE "ChatMessage" ADD COLUMN "card" JSONB,
ADD COLUMN "viaApp" TEXT;
