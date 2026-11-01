-- «مخزون التصنيع»: the stock and cost ledger of a manufacturing space (materials, unit conversions, suppliers, lots, the append-only
-- movement ledger and the stocktakes that need a second person).
--
-- Additive only. Six NEW tables, empty, each with its own indexes, foreign keys and checks, plus two trigger functions of their own.
-- Nothing that exists is renamed, dropped, rewritten or constrained. Quantities are BIGINT micro-units of the material's base unit,
-- money is BIGINT minor units plus a currency code: no floating point anywhere.

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "baseUnit" TEXT NOT NULL,
    "lowStockMicro" BIGINT,
    "currency" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialUnit" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "den" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialLot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT,
    "receivedOn" DATE NOT NULL,
    "expiresOn" DATE,
    "qtyMicro" BIGINT NOT NULL,
    "enteredQtyMicro" BIGINT NOT NULL,
    "enteredUnitLabel" TEXT NOT NULL,
    "unitCostMinor" BIGINT NOT NULL,
    "totalCostMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "proofFileId" TEXT,
    "proofNote" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialMovement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "lotId" TEXT,
    "kind" TEXT NOT NULL,
    "qtyMicro" BIGINT NOT NULL,
    "valueMinor" BIGINT NOT NULL,
    "reason" TEXT,
    "reversesId" TEXT,
    "countId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedQtyMicro" BIGINT NOT NULL,
    "expectedQtyMicro" BIGINT NOT NULL,
    "diffMicro" BIGINT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Material_orgId_workspaceId_archivedAt_idx" ON "Material"("orgId", "workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Material_workspaceId_code_key" ON "Material"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialUnit_materialId_label_key" ON "MaterialUnit"("materialId", "label");

-- CreateIndex
CREATE INDEX "Supplier_orgId_workspaceId_archivedAt_idx" ON "Supplier"("orgId", "workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "MaterialLot_materialId_receivedOn_idx" ON "MaterialLot"("materialId", "receivedOn");

-- CreateIndex
CREATE INDEX "MaterialLot_orgId_workspaceId_idx" ON "MaterialLot"("orgId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialMovement_reversesId_key" ON "MaterialMovement"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialMovement_countId_key" ON "MaterialMovement"("countId");

-- CreateIndex
CREATE INDEX "MaterialMovement_materialId_createdAt_idx" ON "MaterialMovement"("materialId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialMovement_orgId_workspaceId_createdAt_idx" ON "MaterialMovement"("orgId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialCount_materialId_status_idx" ON "MaterialCount"("materialId", "status");

-- CreateIndex
CREATE INDEX "MaterialCount_orgId_workspaceId_status_createdAt_idx" ON "MaterialCount"("orgId", "workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialUnit" ADD CONSTRAINT "MaterialUnit_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "MaterialLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_countId_fkey" FOREIGN KEY ("countId") REFERENCES "MaterialCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- checks (the tables are new, so they meet no rows) ----------

ALTER TABLE "Material" ADD CONSTRAINT "Material_name_check" CHECK (length(btrim("name")) > 0 AND length(btrim("baseUnit")) > 0);
ALTER TABLE "Material" ADD CONSTRAINT "Material_low_stock_check" CHECK ("lowStockMicro" IS NULL OR "lowStockMicro" >= 0);
ALTER TABLE "Material" ADD CONSTRAINT "Material_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

-- a conversion is a positive exact fraction: 1 label = num / den base units
ALTER TABLE "MaterialUnit" ADD CONSTRAINT "MaterialUnit_fraction_check" CHECK ("num" > 0 AND "den" > 0 AND length(btrim("label")) > 0);

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_name_check" CHECK (length(btrim("name")) > 0);

-- a receipt brings something in, costs something that is not negative, and carries its proof: the photo, or the reason there is none
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_amounts_check" CHECK ("qtyMicro" > 0 AND "enteredQtyMicro" > 0 AND "unitCostMinor" >= 0 AND "totalCostMinor" >= 0);
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "MaterialLot" ADD CONSTRAINT "MaterialLot_proof_check" CHECK ("proofFileId" IS NOT NULL OR length(btrim(coalesce("proofNote", ''))) > 0);

-- a movement moves something, in the direction its kind says, and its value never points the other way
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_kind_check" CHECK ("kind" IN ('RECEIVE', 'ISSUE', 'ADJUST', 'COUNT_ADJUST', 'REVERSE'));
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_direction_check" CHECK (
  ("qtyMicro" > 0 AND "valueMinor" >= 0 AND "kind" <> 'ISSUE') OR ("qtyMicro" < 0 AND "valueMinor" <= 0 AND "kind" <> 'RECEIVE')
);
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_link_check" CHECK (
  ("kind" = 'RECEIVE' AND "lotId" IS NOT NULL) OR ("kind" = 'REVERSE' AND "reversesId" IS NOT NULL) OR ("kind" = 'COUNT_ADJUST' AND "countId" IS NOT NULL) OR "kind" IN ('ISSUE', 'ADJUST')
);

-- a stocktake: four states, and whoever decides it is not whoever counted
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'MATCHED'));
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_counted_check" CHECK ("countedQtyMicro" >= 0 AND "expectedQtyMicro" >= 0);
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_second_person_check" CHECK ("decidedById" IS NULL OR "decidedById" <> "countedById");
ALTER TABLE "MaterialCount" ADD CONSTRAINT "MaterialCount_decided_check" CHECK ("status" IN ('PENDING', 'MATCHED') OR "decidedById" IS NOT NULL);

-- ---------- append-only ----------
-- A lot and a movement are history: written once, never changed. A mistake is corrected by a reversing movement, never by an edit.
-- A DELETE is refused too, except one that is part of a cascade (removing a space or a company), which must keep working.

CREATE OR REPLACE FUNCTION "mfg_ledger_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the stock ledger is append-only: % are never changed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "mfg_ledger_refuse_delete"() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'the stock ledger is append-only: % are never removed', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MaterialMovement_append_only"
  BEFORE UPDATE ON "MaterialMovement"
  FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();

CREATE TRIGGER "MaterialLot_append_only"
  BEFORE UPDATE ON "MaterialLot"
  FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_update"();

CREATE TRIGGER "MaterialMovement_no_delete"
  BEFORE DELETE ON "MaterialMovement"
  FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();

CREATE TRIGGER "MaterialLot_no_delete"
  BEFORE DELETE ON "MaterialLot"
  FOR EACH ROW EXECUTE FUNCTION "mfg_ledger_refuse_delete"();
