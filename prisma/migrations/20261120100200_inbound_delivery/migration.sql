-- A delivery received from another system, once (I1.1a): a NEW table, additive. No body, no customer data: company, source, the sender's delivery id, the event name, the time.
CREATE TABLE "InboundDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundDelivery_orgId_source_deliveryId_key" ON "InboundDelivery"("orgId", "source", "deliveryId");

CREATE INDEX "InboundDelivery_orgId_source_event_receivedAt_idx" ON "InboundDelivery"("orgId", "source", "event", "receivedAt");

ALTER TABLE "InboundDelivery" ADD CONSTRAINT "InboundDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
