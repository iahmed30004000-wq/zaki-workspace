-- توكنات الأنظمة (W1): which consuming system a door token was made for (additive: one nullable column)
ALTER TABLE "ApiToken" ADD COLUMN "system" TEXT;
