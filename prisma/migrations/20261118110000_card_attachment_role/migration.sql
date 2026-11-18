-- صور المنتج وآراء الزباين (Q1.2): additive columns on CardAttachment
ALTER TABLE "CardAttachment" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'GALLERY',
ADD COLUMN "meta" JSONB;
