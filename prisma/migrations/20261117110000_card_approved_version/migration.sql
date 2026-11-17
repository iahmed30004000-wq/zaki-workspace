-- «كرت المنتج» (Q1.1): the version of a PRODUCT or REPLY card a moderator approved (additive: one nullable column).
ALTER TABLE "Card" ADD COLUMN "approvedVersion" INTEGER;
