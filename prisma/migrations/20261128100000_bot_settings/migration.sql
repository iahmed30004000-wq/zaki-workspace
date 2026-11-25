-- «بوت فاذر»: «/setjoingroups» (may the bot be added to a topic of chosen people) and «/setprivacy» (ON: only the messages that address it).
-- Additive: both default to what every bot does today.
ALTER TABLE "Bot" ADD COLUMN "joinGroups" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Bot" ADD COLUMN "privacyMode" BOOLEAN NOT NULL DEFAULT true;
