-- «تفريغ الصوت» chosen on the owner's AI settings screen: which speech-to-text service the voice notes go to. Additive only: three nullable columns, nothing is moved or dropped.
ALTER TABLE "AiSettings" ADD COLUMN "transcribeSource" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "transcribeBaseUrl" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "transcribeModel" TEXT;
