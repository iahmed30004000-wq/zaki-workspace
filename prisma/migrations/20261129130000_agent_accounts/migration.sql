-- «حساب وكيل» 🤖 and «باسم مين» on a door token. Additive: no account is an agent and every token keeps acting as its maker.
ALTER TABLE "OrganizationMember" ADD COLUMN "agent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ApiToken" ADD COLUMN "actsAsId" TEXT;
CREATE INDEX "ApiToken_actsAsId_idx" ON "ApiToken"("actsAsId");
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_actsAsId_fkey" FOREIGN KEY ("actsAsId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
