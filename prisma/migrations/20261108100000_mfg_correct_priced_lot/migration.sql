-- «تصحيح سعر دفعة» for a lot priced ON ITS RECEIPT too (the owner's ask, 2026-11-02): a receipt already partly used cannot be reversed and entered
-- again, so its wrong price is corrected like a late one. Only the guard changes (no table, no column): a correction is for a lot that HAS a price,
-- either typed on the receipt or filled in later; it keeps the currency of the lot's first price and is numbered 1, 2, 3 without a gap. The finished
-- goods of a production order (a priced output lot) are priced by the order's cost and take no correction. Everything else stays as it was.
CREATE OR REPLACE FUNCTION "mfg_price_correction_guard"() RETURNS trigger AS $$
DECLARE
  lot RECORD;
  first_currency TEXT;
  last_seq INTEGER;
BEGIN
  SELECT "materialId", "orgId", "workspaceId", "costPending", "currency" INTO lot FROM "MaterialLot" WHERE "id" = NEW."lotId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a price is corrected only for a lot that exists';
  END IF;
  IF lot."materialId" <> NEW."materialId" OR lot."orgId" <> NEW."orgId" OR lot."workspaceId" <> NEW."workspaceId" THEN
    RAISE EXCEPTION 'the correction belongs to another material, space or company than its lot';
  END IF;
  IF lot."costPending" IS TRUE THEN
    SELECT "currency" INTO first_currency FROM "MaterialCosting" WHERE "lotId" = NEW."lotId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a lot is corrected only after its first price was filled in';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "ProductionOrder" WHERE "outputLotId" = NEW."lotId") THEN
      RAISE EXCEPTION 'the finished goods of an order are priced by the order, not corrected';
    END IF;
    first_currency := lot."currency";
  END IF;
  IF first_currency <> NEW."currency" THEN
    RAISE EXCEPTION 'a correction keeps the currency of the first price';
  END IF;
  SELECT COALESCE(MAX("seq"), 0) INTO last_seq FROM "MaterialPriceCorrection" WHERE "lotId" = NEW."lotId";
  IF NEW."seq" <> last_seq + 1 THEN
    RAISE EXCEPTION 'the corrections of a lot are numbered 1, 2, 3 without a gap';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
