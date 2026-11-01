-- «مخزون التصنيع», slice 3: a wrong late price can be corrected, a DRAFT order can be edited, finished goods enter stock, and the cost of an order
-- is split so that its pieces add up to it exactly.
--
-- Additive only. TWO NEW tables (MaterialPriceCorrection, ProductionOrderCostLine), both empty, each with its own indexes, foreign keys, checks and
-- triggers; TWO NEW nullable columns ("Recipe"."outputMaterialId" and "ProductionOrder"."outputLotId": no default, nothing is rewritten and no
-- existing row changes). Nothing that exists is renamed, dropped or retyped: slice 2's "MaterialCosting_lotId_key" (one first price per lot) stays,
-- and every later price of a lot is a row of the new table (unique per lot AND sequence number). The two new unique indexes are on columns this
-- same migration adds (born NULL, so they cannot collide) or on a table it creates.
--
-- The only things REPLACED are three guards, with CREATE OR REPLACE (nothing is dropped): "mfg_order_guard" (the plan and the note of an order may
-- change while it is DRAFT and only then, and the output lot is written once, with the completion), the delete guard of an order line (a line of a
-- DRAFT order is replaced when the order is edited; any other delete is refused as before), and its trigger. The append-only functions of slice 1
-- are reused, not touched.
--
-- Quantities are BIGINT micro-units, money is BIGINT minor units: no floating point anywhere.

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "outputMaterialId" TEXT;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "outputLotId" TEXT;

-- CreateTable
CREATE TABLE "MaterialPriceCorrection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "unitCostMinor" BIGINT NOT NULL,
    "totalCostMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPriceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderCostLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "lotId" TEXT,
    "qtyMicro" BIGINT NOT NULL,
    "valueMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "lotTotalMinor" BIGINT,
    "lotQtyMicro" BIGINT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderCostLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialPriceCorrection_materialId_idx" ON "MaterialPriceCorrection"("materialId");

-- CreateIndex
CREATE INDEX "MaterialPriceCorrection_orgId_workspaceId_idx" ON "MaterialPriceCorrection"("orgId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialPriceCorrection_lotId_seq_key" ON "MaterialPriceCorrection"("lotId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderCostLine_movementId_key" ON "ProductionOrderCostLine"("movementId");

-- CreateIndex
CREATE INDEX "ProductionOrderCostLine_orderId_idx" ON "ProductionOrderCostLine"("orderId");

-- CreateIndex
CREATE INDEX "Recipe_outputMaterialId_idx" ON "Recipe"("outputMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_outputLotId_key" ON "ProductionOrder"("outputLotId");

-- AddForeignKey
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_outputMaterialId_fkey" FOREIGN KEY ("outputMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_outputLotId_fkey" FOREIGN KEY ("outputLotId") REFERENCES "MaterialLot"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "MaterialMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- checks (the new tables meet no rows) ----------

-- a correction: a numbered, reasoned, non-negative price in a real currency (XXX, the placeholder an unpriced lot may carry, is not one)
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_check" CHECK ("seq" > 0 AND "unitCostMinor" >= 0 AND "totalCostMinor" >= 0 AND length(btrim("reason")) > 1);
ALTER TABLE "MaterialPriceCorrection" ADD CONSTRAINT "MaterialPriceCorrection_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$' AND "currency" <> 'XXX');

-- a frozen piece of the cost of an order: a real quantity, a non-negative share, a real currency
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_check" CHECK ("qtyMicro" > 0 AND "valueMinor" >= 0 AND "position" >= 0 AND ("lotTotalMinor" IS NULL OR "lotTotalMinor" >= 0) AND ("lotQtyMicro" IS NULL OR "lotQtyMicro" > 0));
ALTER TABLE "ProductionOrderCostLine" ADD CONSTRAINT "ProductionOrderCostLine_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$' AND "currency" <> 'XXX');

-- ---------- guards ----------

-- A correction is for a lot that was received without a price AND has been priced, of that very material, space and company; it keeps the currency
-- of the first price and is numbered 1, 2, 3 without a gap (the unique index on (lotId, seq) is the last word when two arrive together).
CREATE OR REPLACE FUNCTION "mfg_price_correction_guard"() RETURNS trigger AS $$
DECLARE
  lot RECORD;
  first_price RECORD;
  last_seq INTEGER;
BEGIN
  SELECT "materialId", "orgId", "workspaceId", "costPending" INTO lot FROM "MaterialLot" WHERE "id" = NEW."lotId";
  IF NOT FOUND OR lot."costPending" IS NOT TRUE THEN
    RAISE EXCEPTION 'a price is corrected only for a lot that was received without one';
  END IF;
  IF lot."materialId" <> NEW."materialId" OR lot."orgId" <> NEW."orgId" OR lot."workspaceId" <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'the correction belongs to another material, space or company than its lot';
  END IF;
  SELECT "currency" INTO first_price FROM "MaterialCosting" WHERE "lotId" = NEW."lotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a lot is corrected only after its first price was filled in';
  END IF;
  IF first_price."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'a correction keeps the currency of the first price';
  END IF;
  SELECT COALESCE(MAX("seq"), 0) INTO last_seq FROM "MaterialPriceCorrection" WHERE "lotId" = NEW."lotId";
  IF NEW."seq" <> last_seq + 1 THEN
    RAISE EXCEPTION 'the corrections of a lot are numbered 1, 2, 3 without a gap';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A frozen cost is written only for a COMPLETED order.
CREATE OR REPLACE FUNCTION "mfg_order_cost_line_guard"() RETURNS trigger AS $$
DECLARE
  st TEXT;
BEGIN
  SELECT "status" INTO st FROM "ProductionOrder" WHERE "id" = NEW."orderId";
  IF st IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'the cost of an order is frozen only when the order is completed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- An order keeps its identity always. Its PLAN (recipe version, planned quantity) and its note change while it is DRAFT and stays DRAFT, and only
-- then. It moves only DRAFT -> ISSUED | CANCELLED and ISSUED -> COMPLETED | RETURNED. Its output lot is written once, by the completion. A closed
-- order is never touched again.
CREATE OR REPLACE FUNCTION "mfg_order_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."orgId" <> OLD."orgId" OR NEW."workspaceId" <> OLD."workspaceId" OR NEW."seq" <> OLD."seq" OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'a production order keeps its plan: a new plan is a new order';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED', 'RETURNED') THEN
    RAISE EXCEPTION 'a closed production order is never changed';
  END IF;
  IF (NEW."recipeVersionId" <> OLD."recipeVersionId" OR NEW."plannedQtyMicro" <> OLD."plannedQtyMicro" OR NEW."note" IS DISTINCT FROM OLD."note")
     AND NOT (OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT') THEN
    RAISE EXCEPTION 'a production order keeps its plan once it is issued: only a draft is edited';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('ISSUED', 'CANCELLED'))
    OR (OLD."status" = 'ISSUED' AND NEW."status" IN ('COMPLETED', 'RETURNED'))
  ) THEN
    RAISE EXCEPTION 'a production order cannot go from % to %', OLD."status", NEW."status";
  END IF;
  IF NEW."outputLotId" IS DISTINCT FROM OLD."outputLotId" AND NOT (OLD."outputLotId" IS NULL AND OLD."status" = 'ISSUED' AND NEW."status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'the finished goods of an order are recorded once, when it is completed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A line of an order is history like the rest of the ledger, except that while the order is still a DRAFT its lines are replaced when it is edited.
-- (A delete that is part of a cascade, removing a space or a company, is allowed as everywhere else in the ledger.)
CREATE OR REPLACE FUNCTION "mfg_order_line_refuse_delete"() RETURNS trigger AS $$
DECLARE
  st TEXT;
BEGIN
  IF pg_trigger_depth() >= 2 THEN
    RETURN OLD;
  END IF;
  SELECT "status" INTO st FROM "ProductionOrder" WHERE "id" = OLD."orderId";
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'the stock ledger is append-only: % of an order that was issued are never removed', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MaterialPriceCorrection_guard"
  BEFORE INSERT ON "MaterialPriceCorrection"
  FOR EACH ROW EXECUTE FUNCTION "mfg_price_correction_guard"();

CREATE TRIGGER "ProductionOrderCostLine_guard"
  BEFORE INSERT ON "ProductionOrderCostLine"
  FOR EACH ROW EXECUTE FUNCTION "mfg_order_cost_line_guard"();

CREATE OR REPLACE TRIGGER "ProductionOrderLine_no_delete"
  BEFORE DELETE ON "ProductionOrderLine"
  FOR EACH ROW EXECUTE FUNCTION "mfg_order_line_refuse_delete"();

-- ---------- append-only (slice 1's functions: an UPDATE is refused, a DELETE too unless it is part of a cascade) ----------

CREATE TRIGGER "MaterialPriceCorrection_append_only" BEFORE UPDATE ON "MaterialPriceCorrection" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();
CREATE TRIGGER "ProductionOrderCostLine_append_only" BEFORE UPDATE ON "ProductionOrderCostLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();

CREATE TRIGGER "MaterialPriceCorrection_no_delete" BEFORE DELETE ON "MaterialPriceCorrection" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "ProductionOrderCostLine_no_delete" BEFORE DELETE ON "ProductionOrderCostLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
