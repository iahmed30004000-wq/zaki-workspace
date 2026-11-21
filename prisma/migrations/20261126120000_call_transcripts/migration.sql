-- S6.2: «محضر الاجتماع» (TEXT only; the owner decided «لا بس كتابة»: no audio is ever stored).
-- Additive: three columns on "Call" (a flag with a default, two nullable) and one NEW table for the written lines. Nothing is dropped, renamed or changed.
-- The table has no audio column and no file reference: it holds who said a sentence, the sentence as text, and when.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "minutes" JSONB,
ADD COLUMN     "minutesState" TEXT,
ADD COLUMN     "transcribe" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CallTranscriptLine" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallTranscriptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallTranscriptLine_callId_at_idx" ON "CallTranscriptLine"("callId", "at");

-- CreateIndex
CREATE INDEX "CallTranscriptLine_at_idx" ON "CallTranscriptLine"("at");

-- AddForeignKey
ALTER TABLE "CallTranscriptLine" ADD CONSTRAINT "CallTranscriptLine_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscriptLine" ADD CONSTRAINT "CallTranscriptLine_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
