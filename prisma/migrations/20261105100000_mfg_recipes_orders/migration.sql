-- «مخزون التصنيع», slice 2: a receipt without a price whose price comes later, recipes (versioned), and production orders.
--
-- Additive only. SEVEN NEW tables (MaterialCosting, Recipe, RecipeVersion, RecipeLine, ProductionOrder, ProductionOrderLine,
-- ProductionOrderMovement), all empty, each with its own indexes, foreign keys, checks and triggers; and ONE new column on MaterialLot
-- ("costPending", NOT NULL with DEFAULT false, so every lot that exists is a priced one and nothing is rewritten). The append-only trigger functions
-- of slice 1 are reused, not touched. Nothing that exists is renamed, dropped or retyped.
--
-- Quantities are BIGINT micro-units, money is BIGINT minor units: no floating point anywhere.

-- AlterTable
ALTER TABLE "MaterialLot" ADD COLUMN     "costPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MaterialCosting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "unitCostMinor" BIGINT NOT NULL,
    "totalCostMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "qtyMicro" BIGINT NOT NULL,
    "enteredQtyMicro" BIGINT NOT NULL,
    "enteredUnitLabel" TEXT NOT NULL,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "recipeVersionId" TEXT NOT NULL,
    "plannedQtyMicro" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "actualQtyMicro" BIGINT,
    "wasteQtyMicro" BIGINT,
    "wasteNote" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "perUnitMicro" BIGINT NOT NULL,
    "requiredMicro" BIGINT NOT NULL,

    CONSTRAINT "ProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderMovement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCosting_lotId_key" ON "MaterialCosting"("lotId");

-- CreateIndex
CREATE INDEX "MaterialCosting_materialId_idx" ON "MaterialCosting"("materialId");

-- CreateIndex
CREATE INDEX "MaterialCosting_orgId_workspaceId_idx" ON "MaterialCosting"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "Recipe_orgId_workspaceId_archivedAt_idx" ON "Recipe"("orgId", "workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_recipeId_version_key" ON "RecipeVersion"("recipeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_versionId_materialId_key" ON "RecipeLine"("versionId", "materialId");

-- CreateIndex
CREATE INDEX "ProductionOrder_orgId_workspaceId_status_createdAt_idx" ON "ProductionOrder"("orgId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_workspaceId_seq_key" ON "ProductionOrder"("workspaceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderLine_orderId_materialId_key" ON "ProductionOrderLine"("orderId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderMovement_movementId_key" ON "ProductionOrderMovement"("movementId");

-- CreateIndex
CREATE INDEX "ProductionOrderMovement_orderId_idx" ON "ProductionOrderMovement"("orderId");

-- AddForeignKey
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RecipeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderMovement" ADD CONSTRAINT "ProductionOrderMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderMovement" ADD CONSTRAINT "ProductionOrderMovement_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderMovement" ADD CONSTRAINT "ProductionOrderMovement_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "MaterialMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------- checks (the new tables meet no rows; the one on MaterialLot is true for every row that exists, they all have costPending = false) ----------

-- an unpriced lot carries no invented price: both amounts are 0 and the flag says so
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_pending_check" CHECK ("costPending" = false OR ("unitCostMinor" = 0 AND "totalCostMinor" = 0));

-- the late price: not negative, a real currency (XXX, the placeholder an unpriced lot may carry, is not one)
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_amounts_check" CHECK ("unitCostMinor" >= 0 AND "totalCostMinor" >= 0);
ALTER TABLE "MaterialCosting" ADD CONSTRAINT "MaterialCosting_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$' AND "currency" <> 'XXX');

ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_check" CHECK ("version" > 0 AND length(btrim("name")) > 0 AND length(btrim("outputUnit")) > 0);
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_check" CHECK ("qtyMicro" > 0 AND "enteredQtyMicro" > 0 AND "position" >= 0 AND length(btrim("enteredUnitLabel")) > 0);

-- an order: a positive plan, five states, and each state carries what it needs
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_plan_check" CHECK ("seq" > 0 AND "plannedQtyMicro" > 0);
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_status_check" CHECK ("status" IN ('DRAFT', 'ISSUED', 'COMPLETED', 'CANCELLED', 'RETURNED'));
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_issued_check" CHECK ("status" IN ('DRAFT', 'CANCELLED') OR ("issuedAt" IS NOT NULL AND "issuedById" IS NOT NULL));
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_completed_check" CHECK ("status" <> 'COMPLETED' OR ("actualQtyMicro" IS NOT NULL AND "actualQtyMicro" > 0 AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL));
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_closed_check" CHECK ("status" NOT IN ('CANCELLED', 'RETURNED') OR ("closedAt" IS NOT NULL AND "closedById" IS NOT NULL));
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_waste_check" CHECK ("wasteQtyMicro" IS NULL OR "wasteQtyMicro" >= 0);

ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_check" CHECK ("perUnitMicro" > 0 AND "requiredMicro" > 0 AND "position" >= 0);

-- ---------- guards ----------

-- A price is filled only for a lot that was received without one, of that very material and company (the lot row is never updated).
CREATE OR REPLACE FUNCTION "mfg_costing_guard"() RETURNS trigger AS $$
DECLARE
  lot RECORD;
BEGIN
  SELECT "materialId", "orgId", "costPending" INTO lot FROM "MaterialLot" WHERE "id" = NEW."lotId";
  IF NOT FOUND OR lot."costPending" IS NOT TRUE THEN
    RAISE EXCEPTION 'a price is filled only for a lot that was received without one';
  END IF;
  IF lot."materialId" <> NEW."materialId" OR lot."orgId" <> NEW."orgId" THEN
    RAISE EXCEPTION 'the price belongs to another material or company than its lot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- An order keeps its plan, and moves only DRAFT -> ISSUED | CANCELLED and ISSUED -> COMPLETED | RETURNED; a closed order is never touched again.
CREATE OR REPLACE FUNCTION "mfg_order_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."orgId" <> OLD."orgId" OR NEW."workspaceId" <> OLD."workspaceId" OR NEW."seq" <> OLD."seq"
     OR NEW."recipeVersionId" <> OLD."recipeVersionId" OR NEW."plannedQtyMicro" <> OLD."plannedQtyMicro" OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'a production order keeps its plan: a new plan is a new order';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED', 'RETURNED') THEN
    RAISE EXCEPTION 'a closed production order is never changed';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('ISSUED', 'CANCELLED'))
    OR (OLD."status" = 'ISSUED' AND NEW."status" IN ('COMPLETED', 'RETURNED'))
  ) THEN
    RAISE EXCEPTION 'a production order cannot go from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MaterialCosting_guard"
  BEFORE INSERT ON "MaterialCosting"
  FOR EACH ROW EXECUTE FUNCTION "mfg_costing_guard"();

CREATE TRIGGER "ProductionOrder_guard"
  BEFORE UPDATE ON "ProductionOrder"
  FOR EACH ROW EXECUTE FUNCTION "mfg_order_guard"();

-- ---------- append-only (the functions are slice 1's: an UPDATE is refused, a DELETE too unless it is part of a cascade) ----------

CREATE TRIGGER "MaterialCosting_append_only" BEFORE UPDATE ON "MaterialCosting" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();
CREATE TRIGGER "RecipeVersion_append_only" BEFORE UPDATE ON "RecipeVersion" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();
CREATE TRIGGER "RecipeLine_append_only" BEFORE UPDATE ON "RecipeLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();
CREATE TRIGGER "ProductionOrderLine_append_only" BEFORE UPDATE ON "ProductionOrderLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();
CREATE TRIGGER "ProductionOrderMovement_append_only" BEFORE UPDATE ON "ProductionOrderMovement" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();

CREATE TRIGGER "MaterialCosting_no_delete" BEFORE DELETE ON "MaterialCosting" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "Recipe_no_delete" BEFORE DELETE ON "Recipe" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "RecipeVersion_no_delete" BEFORE DELETE ON "RecipeVersion" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "RecipeLine_no_delete" BEFORE DELETE ON "RecipeLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "ProductionOrder_no_delete" BEFORE DELETE ON "ProductionOrder" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "ProductionOrderLine_no_delete" BEFORE DELETE ON "ProductionOrderLine" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
CREATE TRIGGER "ProductionOrderMovement_no_delete" BEFORE DELETE ON "ProductionOrderMovement" FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
