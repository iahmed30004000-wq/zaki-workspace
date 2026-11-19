-- C3a.2: the person's chat preferences (folders, hidden tabs, notification and chat sections, voice speed) in ONE nullable JSON column on the user.
-- Additive: no row is rewritten; NULL means "all defaults". Validated by one zod schema in src/lib/chat/prefs.ts, not by the database.
ALTER TABLE "User" ADD COLUMN "chatPrefs" JSONB;
