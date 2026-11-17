-- «ربط نظام الطلبات» (Q1.0): the orders system's snapshot of a product, kept beside the sheet and outside its versions (additive: one nullable column).
ALTER TABLE "Card" ADD COLUMN "external" JSONB;
