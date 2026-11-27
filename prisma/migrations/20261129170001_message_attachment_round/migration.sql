-- «رسالة فيديو دائرية»: marks the one attachment of a round video message. Additive: every row made before is false.
ALTER TABLE "MessageAttachment" ADD COLUMN "round" BOOLEAN NOT NULL DEFAULT false;
