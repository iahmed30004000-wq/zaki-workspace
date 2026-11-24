-- a group picture, work hours and the away line: three nullable columns. Additive only: nothing is moved or dropped.
ALTER TABLE "TopicGroup" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "workHours" JSONB,
ADD COLUMN "chatAutomation" JSONB;
