-- The hosts a card button of the door may point at (I1.1b): one array column with an empty default (no host = no button accepted).
ALTER TABLE "ApiToken" ADD COLUMN "buttonHosts" TEXT[] DEFAULT ARRAY[]::TEXT[];
