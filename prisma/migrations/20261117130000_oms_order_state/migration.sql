-- حالة الطلب (Q1.4): a NEW table, additive. A small cache of what the orders system's door sends about an order; no customer data.
CREATE TABLE "OmsOrderState" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT,
    "confirmationState" TEXT,
    "shippingState" TEXT,
    "productName" TEXT,
    "quantity" INTEGER,
    "movedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmsOrderState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OmsOrderState_orgId_orderNumber_key" ON "OmsOrderState"("orgId", "orderNumber");

ALTER TABLE "OmsOrderState" ADD CONSTRAINT "OmsOrderState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
