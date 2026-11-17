-- المشاكل تصير تذاكر (Q1.5): additive columns on Ticket (all nullable) and two indexes
ALTER TABLE "Ticket" ADD COLUMN "externalRef" TEXT,
ADD COLUMN "kindKey" TEXT,
ADD COLUMN "followUpAt" TIMESTAMP(3),
ADD COLUMN "customerRefCipher" TEXT,
ADD COLUMN "customerRefHash" TEXT;

CREATE INDEX "Ticket_orgId_externalRef_idx" ON "Ticket"("orgId", "externalRef");

CREATE INDEX "Ticket_orgId_customerRefHash_idx" ON "Ticket"("orgId", "customerRefHash");
