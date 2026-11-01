-- «نموذج محلي»: which model each assistant uses, and the settings of the two local providers. Additive only: every column is nullable
-- or has a DEFAULT, so the rows that exist keep working exactly as before (provider "claude", nothing local configured).
ALTER TABLE "AiSettings" ADD COLUMN "ownerProvider" TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE "AiSettings" ADD COLUMN "chatProvider" TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE "AiSettings" ADD COLUMN "localBaseUrl" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "localModel" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "gatewayBaseUrl" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "gatewayModel" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "gatewayKeyCipher" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "gatewayKeyLast4" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "gatewayConfirmedLocal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiSettings" ADD COLUMN "localRelaxRedaction" BOOLEAN NOT NULL DEFAULT false;
