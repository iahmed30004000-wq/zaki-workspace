import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import {
  LIMITS,
  MAX_BALANCE_MICRO,
  MAX_MOVEMENT_MICRO,
  averageText,
  divRound,
  parseQtyMicro,
  toBaseMicro,
  toSafeNumber,
} from "@/lib/manufacturing/shared";
import { costOfPieces, perUnitText, planFifo, requiredMicro, type CostPiece, type Position } from "@/lib/manufacturing/costing";
import {
  isOrderStatus,
  type OrderCost,
  type OrderCostLine,
  type OrderItem,
  type OrderLineItem,
  type OrdersView,
  type RecipeItem,
  type RecipeMaterial,
  type RecipeVersionItem,
  type RecipesView,
} from "@/lib/manufacturing/production-view";
import { assertEdit, mfgScope, notFound, recordMfg, type MfgScope } from "./manufacturing-access";
import { EMPTY_POSITION, effectiveCost, loadLotsByIds, loadPosition, loadSpacePositions } from "./manufacturing-costing";

/**
 * «مخزون التصنيع», slice 2 — recipes and production orders. They extend the ledger and add no second stock:
 *
 *  - a RECIPE is an identity plus versions that are written once and never edited (a change is a new version; an old one stays readable, and an
 *    order keeps the version it was made from). A recipe is archived, never deleted. Its lines say how much of a material ONE output unit takes,
 *    typed in any unit of the material and kept exactly in the base unit. A recipe holds no price.
 *  - a PRODUCTION ORDER plans a quantity of a recipe version: DRAFT → ISSUED → COMPLETED, or CANCELLED (a draft only) or RETURNED (after the issue).
 *      ISSUE      takes the materials out of stock, FIRST-IN-FIRST-OUT by lot, as ordinary ISSUE movements linked to the order, all of them in ONE
 *                 transaction under the materials' row locks: either everything the order needs is there and is taken, or nothing is.
 *      COMPLETE   records the real output (and an optional waste line). The cost of the order is the sum of what it consumed, divided by the real output.
 *      RETURN     puts the issued materials back by reversing movements (the originals stay): the only way back after an issue.
 *  - the COST of an order is not stored: it is read from the quantities the order took, each from its lot at that lot's price, as an exact sum
 *    rounded half-up once. A lot received without a price adds nothing and marks the cost incomplete («ناقص»): never invented.
 *
 * ⚠️ The issue step moves stock by itself. 🔧 The order lists exactly what it took, lot by lot, and the return step undoes it.
 */

const invalid = (path: string, message: string) => new ValidationError([{ path, message }]);
const num = toSafeNumber;

type Tx = Prisma.TransactionClient;

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max, message);
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));
const qtyText = z.string().trim().min(1, "mfg.e.qty").max(24, "mfg.e.qty");

// ───────────────────────────────────────── what a request may carry ─────────────────────────────────────────

const recipeLineSchema = z.object({
  materialId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64).nullable().optional(),
  /** How much of the material ONE output unit takes, in the chosen unit, as typed. */
  qty: qtyText,
});

const recipeBody = {
  name: text(LIMITS.name, "mfg.e.name"),
  outputUnit: text(LIMITS.unit, "mfg.e.output_unit"),
  note: optionalText(LIMITS.note, "mfg.e.note"),
  lines: z.array(recipeLineSchema).min(1, "mfg.e.recipe_lines").max(60, "mfg.e.recipe_lines"),
};

export const createRecipeSchema = z.object({ spaceId: z.string().min(1).max(64), ...recipeBody });
export const newVersionSchema = z.object(recipeBody);
export const archiveRecipeSchema = z.object({ archived: z.boolean() });

export const createOrderSchema = z.object({
  spaceId: z.string().min(1).max(64),
  recipeId: z.string().min(1).max(64),
  /** The planned output, in the recipe's output unit, as typed. */
  qty: qtyText,
  note: optionalText(LIMITS.note, "mfg.e.note"),
});

export const completeOrderSchema = z.object({
  actualQty: qtyText,
  wasteQty: z.string().trim().max(24, "mfg.e.qty").nullable().optional(),
  wasteNote: optionalText(LIMITS.reason, "mfg.e.reason"),
});

export const closeOrderSchema = z.object({ reason: z.string().trim().min(2, "mfg.e.reason").max(LIMITS.reason, "mfg.e.reason") });

// ───────────────────────────────────────── recipes ─────────────────────────────────────────

const VERSION_INCLUDE = {
  createdBy: { select: { name: true } },
  lines: { orderBy: { position: "asc" }, include: { material: { select: { name: true, baseUnit: true, archivedAt: true } } } },
} satisfies Prisma.RecipeVersionInclude;

type VersionRow = Prisma.RecipeVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

function versionItemOf(v: VersionRow): RecipeVersionItem {
  return {
    id: v.id,
    version: v.version,
    name: v.name,
    outputUnit: v.outputUnit,
    note: v.note,
    createdBy: v.createdBy.name,
    createdAt: v.createdAt.toISOString(),
    lines: v.lines.map((l) => ({
      id: l.id,
      materialId: l.materialId,
      materialName: l.material.name,
      baseUnit: l.material.baseUnit,
      qtyMicro: num(l.qtyMicro),
      enteredQtyMicro: num(l.enteredQtyMicro),
      enteredUnitLabel: l.enteredUnitLabel,
      materialArchived: l.material.archivedAt !== null,
    })),
  };
}

/** The recipes of a space with every version, and the materials a line can be typed for. Prices appear nowhere here. */
export async function readRecipes(actor: Actor, spaceId: string): Promise<RecipesView> {
  const scope = await mfgScope(actor, spaceId);
  const [recipes, materials] = await Promise.all([
    db.recipe.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }, { id: "asc" }],
      take: LIMITS.list,
      include: { versions: { orderBy: { version: "desc" }, include: VERSION_INCLUDE } },
    }),
    db.material.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: LIMITS.list,
      select: { id: true, name: true, baseUnit: true, units: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, label: true, num: true, den: true, archivedAt: true } } },
    }),
  ]);
  const items: RecipeItem[] = recipes.flatMap((r) => {
    const versions = r.versions.map(versionItemOf);
    const current = versions[0];
    return current ? [{ id: r.id, archived: r.archivedAt !== null, current, versions }] : [];
  });
  const pickable: RecipeMaterial[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    units: m.units.map((u) => ({ id: u.id, label: u.label, num: u.num, den: u.den, archived: u.archivedAt !== null })),
  }));
  return { spaceId, spaceName: scope.spaceName, canEdit: scope.canEdit, canCost: scope.canCost, recipes: items, materials: pickable };
}

/** The lines of a version typed in the person's units, checked against the space's own (open) materials and turned into exact base quantities. */
async function resolveLines(actor: Actor, spaceId: string, lines: z.infer<typeof recipeBody.lines>) {
  const ids = lines.map((l) => l.materialId);
  if (new Set(ids).size !== ids.length) throw invalid("lines", "mfg.e.recipe_dup");
  const materials = await db.material.findMany({
    where: { id: { in: ids }, orgId: actor.orgId, workspaceId: spaceId },
    select: { id: true, baseUnit: true, archivedAt: true, units: { where: { archivedAt: null }, select: { id: true, label: true, num: true, den: true } } },
  });
  const byId = new Map(materials.map((m) => [m.id, m] as const));
  return lines.map((line, position) => {
    const material = byId.get(line.materialId);
    if (!material) throw invalid("lines", "mfg.e.recipe_material");
    if (material.archivedAt) throw invalid("lines", "mfg.e.archived");
    const unit = line.unitId ? material.units.find((u) => u.id === line.unitId) : null;
    if (line.unitId && !unit) throw invalid("lines", "mfg.e.unit");
    const conversion = unit ? { num: unit.num, den: unit.den } : { num: 1, den: 1 };
    const entered = parseQtyMicro(line.qty);
    if (entered === null || entered === 0n) throw invalid("lines", "mfg.e.qty");
    const base = toBaseMicro(entered, conversion);
    if (base === null) throw invalid("lines", "mfg.e.qty_exact");
    if (base > MAX_MOVEMENT_MICRO) throw invalid("lines", "mfg.e.qty_big");
    return { materialId: material.id, position, qtyMicro: base, enteredQtyMicro: entered, enteredUnitLabel: unit ? unit.label : material.baseUnit };
  });
}

/** «وصفة جديدة»: the recipe and its first version. Needs `manufacturing.edit`. */
export async function createRecipe(actor: Actor, input: z.infer<typeof createRecipeSchema>): Promise<{ id: string; versionId: string }> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const lines = await resolveLines(actor, input.spaceId, input.lines);
  const made = await db.recipe.create({
    data: {
      orgId: actor.orgId,
      workspaceId: input.spaceId,
      createdById: actor.userId,
      versions: { create: { version: 1, name: input.name, outputUnit: input.outputUnit, note: input.note, createdById: actor.userId, lines: { create: lines } } },
    },
    select: { id: true, versions: { select: { id: true } } },
  });
  await recordMfg(actor, input.spaceId, "recipe_created", made.id, { name: input.name, lines: lines.length });
  return { id: made.id, versionId: made.versions[0]!.id };
}

/** A change to a recipe is a NEW version (the next number); the old ones are never edited. Refused for an archived recipe. */
export async function addRecipeVersion(actor: Actor, recipeId: string, input: z.infer<typeof newVersionSchema>): Promise<{ versionId: string; version: number }> {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: actor.orgId }, select: { id: true, workspaceId: true, archivedAt: true } });
  if (!recipe) throw notFound();
  const scope = await mfgScope(actor, recipe.workspaceId);
  assertEdit(scope);
  if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
  const lines = await resolveLines(actor, recipe.workspaceId, input.lines);
  const made = await db.$transaction(async (tx) => {
    // two people saving at once: one waits for the other and takes the next number (the unique index is the last word)
    await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipe.id} FOR UPDATE`;
    const last = await tx.recipeVersion.aggregate({ where: { recipeId: recipe.id }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const row = await tx.recipeVersion.create({
      data: { recipeId: recipe.id, version, name: input.name, outputUnit: input.outputUnit, note: input.note, createdById: actor.userId, lines: { create: lines } },
      select: { id: true },
    });
    return { versionId: row.id, version };
  });
  await recordMfg(actor, recipe.workspaceId, "recipe_versioned", recipe.id, { version: made.version, name: input.name });
  return made;
}

/** Archive or restore a recipe (never deleted). Orders already made from it are not touched. */
export async function archiveRecipe(actor: Actor, recipeId: string, input: z.infer<typeof archiveRecipeSchema>): Promise<{ ok: true }> {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: actor.orgId }, select: { id: true, workspaceId: true, archivedAt: true } });
  if (!recipe) throw notFound();
  const scope = await mfgScope(actor, recipe.workspaceId);
  assertEdit(scope);
  if (input.archived !== (recipe.archivedAt !== null)) {
    await db.recipe.update({ where: { id: recipe.id }, data: { archivedAt: input.archived ? new Date() : null } });
    await recordMfg(actor, recipe.workspaceId, input.archived ? "recipe_archived" : "recipe_restored", recipe.id);
  }
  return { ok: true };
}

// ───────────────────────────────────────── reading orders ─────────────────────────────────────────

const ORDER_INCLUDE = {
  createdBy: { select: { name: true } },
  recipeVersion: { select: { version: true, name: true, outputUnit: true, recipeId: true } },
  lines: { orderBy: { position: "asc" }, include: { material: { select: { id: true, name: true, baseUnit: true, currency: true, archivedAt: true } } } },
} satisfies Prisma.ProductionOrderInclude;

type OrderRow = Prisma.ProductionOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * What each order took, net of what it returned: the sum of the movements linked to it, grouped by line and lot. An issue is a negative
 * movement and a return a positive one, so the sum of `−qty` is what the order holds now.
 */
async function netTaken(orderIds: readonly string[]) {
  const links = orderIds.length === 0 ? [] : await db.productionOrderMovement.findMany({ where: { orderId: { in: [...orderIds] } }, select: { orderId: true, lineId: true, movement: { select: { qtyMicro: true, valueMinor: true, lotId: true } } } });
  const net = new Map<string, { orderId: string; lineId: string; lotId: string | null; qty: bigint; value: bigint }>();
  for (const l of links) {
    const key = `${l.lineId}|${l.movement.lotId ?? ""}`;
    const cur = net.get(key) ?? { orderId: l.orderId, lineId: l.lineId, lotId: l.movement.lotId, qty: 0n, value: 0n };
    cur.qty -= l.movement.qtyMicro;
    cur.value -= l.movement.valueMinor;
    net.set(key, cur);
  }
  return [...net.values()];
}

type Net = Awaited<ReturnType<typeof netTaken>>[number];

function orderItemOf(scope: MfgScope, o: OrderRow, taken: readonly Net[], positions: ReadonlyMap<string, Position>, lots: Awaited<ReturnType<typeof loadLotsByIds>>): OrderItem {
  const mine = taken.filter((n) => n.orderId === o.id && n.qty > 0n);
  const issuedByLine = new Map<string, bigint>();
  for (const n of mine) issuedByLine.set(n.lineId, (issuedByLine.get(n.lineId) ?? 0n) + n.qty);

  const lines: OrderLineItem[] = o.lines.map((l) => {
    const pos = positions.get(l.materialId) ?? EMPTY_POSITION;
    return {
      id: l.id,
      materialId: l.materialId,
      materialName: l.material.name,
      baseUnit: l.material.baseUnit,
      perUnitMicro: num(l.perUnitMicro),
      requiredMicro: num(l.requiredMicro),
      balanceMicro: num(pos.qtyMicro),
      unpricedMicro: num(pos.unpricedQtyMicro),
      issuedMicro: num(issuedByLine.get(l.id) ?? 0n),
      enough: pos.qtyMicro >= l.requiredMicro,
    };
  });

  // the cost: every piece the order holds, at its lot's price
  const pieces: { line: (typeof o.lines)[number]; net: Net }[] = [];
  for (const n of mine) {
    const line = o.lines.find((l) => l.id === n.lineId);
    if (line) pieces.push({ line, net: n });
  }
  const costPieces: CostPiece[] = pieces.map(({ line, net }) => {
    const lot = net.lotId ? lots.get(net.lotId) : undefined;
    const price = lot ? effectiveCost(lot) : null;
    return { currency: line.material.currency, qtyMicro: net.qty, lot: lot ? { qtyMicro: lot.qtyMicro, totalMinor: price ? price.totalMinor : null } : null, valueMinor: net.value };
  });
  const cost = costOfPieces(costPieces);
  const costIncomplete = pieces.length > 0 && !cost.complete;

  let costView: OrderCost | null = null;
  if (scope.canCost && pieces.length > 0) {
    const actual = o.actualQtyMicro;
    const costLines: OrderCostLine[] = o.lines.flatMap((line) => {
      const own = pieces.filter((p) => p.line.id === line.id);
      if (own.length === 0) return [];
      return [
        {
          materialName: line.material.name,
          baseUnit: line.material.baseUnit,
          currency: line.material.currency,
          qtyMicro: num(own.reduce((sum, p) => sum + p.net.qty, 0n)),
          pieces: own
            .map((p) => {
              const lot = p.net.lotId ? lots.get(p.net.lotId) : undefined;
              const price = lot ? effectiveCost(lot) : null;
              const currency = price?.currency ?? line.material.currency;
              return {
                at: lot ? lot.receivedOn.getTime() : Number.MAX_SAFE_INTEGER,
                piece: {
                  lotReceivedOn: lot ? lot.receivedOn.toISOString().slice(0, 10) : null,
                  qtyMicro: num(p.net.qty),
                  unitText: lot && price && currency ? averageText(price.totalMinor, lot.qtyMicro, currency) : !lot && currency && p.net.value > 0n ? averageText(p.net.value, p.net.qty, currency) : null,
                  amountMinor: lot ? (price ? num(divRound(p.net.qty * price.totalMinor, lot.qtyMicro)) : null) : p.net.value > 0n ? num(p.net.value) : null,
                },
              };
            })
            .sort((a, b) => a.at - b.at)
            .map((x) => x.piece),
        },
      ];
    });
    costView = {
      totals: cost.byCurrency.map((c) => ({ currency: c.currency, totalMinor: num(c.totalMinor), perUnitText: actual ? perUnitText(c, actual) : null })),
      lines: costLines,
    };
  }

  const status = isOrderStatus(o.status) ? o.status : "DRAFT";
  return {
    id: o.id,
    seq: o.seq,
    status,
    recipeId: o.recipeVersion.recipeId,
    recipeName: o.recipeVersion.name,
    version: o.recipeVersion.version,
    outputUnit: o.recipeVersion.outputUnit,
    plannedMicro: num(o.plannedQtyMicro),
    actualMicro: o.actualQtyMicro === null ? null : num(o.actualQtyMicro),
    wasteMicro: o.wasteQtyMicro === null ? null : num(o.wasteQtyMicro),
    wasteNote: o.wasteNote,
    note: o.note,
    createdBy: o.createdBy.name,
    createdAt: o.createdAt.toISOString(),
    issuedAt: o.issuedAt ? o.issuedAt.toISOString() : null,
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    closeNote: o.closeNote,
    lines,
    costIncomplete,
    cost: costView,
    canIssue: scope.canEdit && status === "DRAFT",
    canComplete: scope.canEdit && status === "ISSUED",
    canCancel: scope.canEdit && status === "DRAFT",
    canReturn: scope.canEdit && status === "ISSUED",
  };
}

/** The orders of a space that match, as the order screen reads them (also what the reports list). */
export async function ordersOf(scope: MfgScope, where: Prisma.ProductionOrderWhereInput, take: number): Promise<OrderItem[]> {
  const orders = await db.productionOrder.findMany({ where: { orgId: scope.actor.orgId, workspaceId: scope.spaceId, ...where }, orderBy: [{ seq: "desc" }], take, include: ORDER_INCLUDE });
  if (orders.length === 0) return [];
  const taken = await netTaken(orders.map((o) => o.id));
  const lots = await loadLotsByIds(db, [...new Set(taken.flatMap((n) => (n.lotId ? [n.lotId] : [])))]);
  const positions = await loadSpacePositions(scope.actor.orgId, scope.spaceId);
  return orders.map((o) => orderItemOf(scope, o, taken, positions, lots));
}

/** The orders of a space, newest first, with what each took and (for a cost holder) what it cost; and the recipes a new order can be made from. */
export async function readOrders(actor: Actor, spaceId: string): Promise<OrdersView> {
  const scope = await mfgScope(actor, spaceId);
  const [orders, recipes] = await Promise.all([
    ordersOf(scope, {}, 200),
    db.recipe.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId, archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: LIMITS.list,
      select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, name: true, outputUnit: true } } },
    }),
  ]);
  return {
    spaceId,
    spaceName: scope.spaceName,
    canEdit: scope.canEdit,
    canCost: scope.canCost,
    orders,
    recipes: recipes.flatMap((r) => (r.versions[0] ? [{ id: r.id, name: r.versions[0].name, outputUnit: r.versions[0].outputUnit, version: r.versions[0].version }] : [])),
  };
}

/** One order (for the answer of a step). */
async function readOrderIn(scope: MfgScope, orderId: string): Promise<OrderItem> {
  const [item] = await ordersOf(scope, { id: orderId }, 1);
  if (!item) throw notFound();
  return item;
}

async function loadOrder(actor: Actor, orderId: string) {
  const order = await db.productionOrder.findFirst({ where: { id: orderId, orgId: actor.orgId }, select: { id: true, workspaceId: true, seq: true } });
  if (!order) throw notFound();
  const scope = await mfgScope(actor, order.workspaceId);
  return { scope, order };
}

// ───────────────────────────────────────── the steps of an order ─────────────────────────────────────────

/** «أمر تصنيع جديد»: a DRAFT for a planned quantity of the recipe's newest version; what it needs of each material is fixed now. Nothing moves. */
export async function createOrder(actor: Actor, input: z.infer<typeof createOrderSchema>): Promise<OrderItem> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, orgId: actor.orgId, workspaceId: input.spaceId },
    select: { id: true, archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, include: { lines: { orderBy: { position: "asc" } } } } },
  });
  if (!recipe) throw invalid("recipeId", "mfg.e.recipe");
  if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
  const version = recipe.versions[0];
  if (!version) throw invalid("recipeId", "mfg.e.recipe");
  const planned = parseQtyMicro(input.qty);
  if (planned === null || planned === 0n) throw invalid("qty", "mfg.e.qty");
  if (planned > MAX_MOVEMENT_MICRO) throw invalid("qty", "mfg.e.qty_big");
  const lines = version.lines.map((l, position) => {
    const required = requiredMicro(l.qtyMicro, planned);
    if (required <= 0n) throw invalid("qty", "mfg.e.order_tiny");
    if (required > MAX_MOVEMENT_MICRO) throw invalid("qty", "mfg.e.qty_big");
    return { materialId: l.materialId, position, perUnitMicro: l.qtyMicro, requiredMicro: required };
  });
  const made = await db.$transaction(async (tx) => {
    // the number of the order: one more than the last of this space (the space's row is the lock)
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${input.spaceId} FOR UPDATE`;
    const last = await tx.productionOrder.aggregate({ where: { workspaceId: input.spaceId }, _max: { seq: true } });
    return tx.productionOrder.create({
      data: { orgId: actor.orgId, workspaceId: input.spaceId, seq: (last._max.seq ?? 0) + 1, recipeVersionId: version.id, plannedQtyMicro: planned, note: input.note, createdById: actor.userId, lines: { create: lines } },
      select: { id: true, seq: true },
    });
  });
  await recordMfg(actor, input.spaceId, "order_created", made.id, { seq: made.seq, recipe: version.name, plannedMicro: num(planned) });
  return readOrderIn(scope, made.id);
}

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ProductionOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  return tx.productionOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { position: "asc" } } } });
}

/** The materials of an order, locked in ONE order (by id) so two orders needing the same materials cannot wait for each other for ever. */
async function lockMaterials(tx: Tx, materialIds: readonly string[]) {
  const sorted = [...new Set(materialIds)].sort();
  const rows = [];
  for (const id of sorted) {
    await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${id} FOR UPDATE`;
    rows.push(await tx.material.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, archivedAt: true } }));
  }
  return new Map(rows.map((m) => [m.id, m] as const));
}

/**
 * «صرف المواد»: DRAFT → ISSUED. Everything the order needs is taken out of stock first-in-first-out, lot by lot, as ISSUE movements linked to
 * the order, in ONE transaction under the materials' row locks. If any material is short (or archived), nothing is taken and the order stays a
 * draft. ⚠️ This moves stock. 🔧 The order lists what it took, lot by lot; «إرجاع المواد» puts it all back by reversing movements.
 */
export async function issueOrder(actor: Actor, orderId: string): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "DRAFT") throw invalid("orderId", "mfg.e.order_state");
    const materials = await lockMaterials(tx, fresh.lines.map((l) => l.materialId));
    for (const line of fresh.lines) {
      const material = materials.get(line.materialId);
      if (!material || material.archivedAt) throw invalid("orderId", "mfg.e.archived");
      const { position } = await loadPosition(tx, line.materialId);
      if (line.requiredMicro > position.qtyMicro) throw invalid(line.materialId, "mfg.e.order_short");
      const plan = planFifo(position, line.requiredMicro);
      if (plan.shortfall > 0n) throw invalid(line.materialId, "mfg.e.order_short");
      for (const piece of plan.pieces) {
        const movement = await tx.materialMovement.create({
          data: {
            orgId: actor.orgId,
            workspaceId: order.workspaceId,
            materialId: line.materialId,
            lotId: piece.lotId,
            kind: "ISSUE",
            qtyMicro: -piece.qtyMicro,
            valueMinor: -piece.valueMinor,
            reason: `أمر تصنيع رقم ${order.seq}`,
            createdById: actor.userId,
          },
          select: { id: true },
        });
        await tx.productionOrderMovement.create({ data: { orderId, lineId: line.id, movementId: movement.id } });
      }
    }
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.userId } });
  });
  await recordMfg(actor, order.workspaceId, "order_issued", orderId, { seq: order.seq });
  return readOrderIn(scope, orderId);
}

/** «إنهاء الأمر»: ISSUED → COMPLETED with the real output (and an optional waste line). The cost per output unit is the cost of what was taken ÷ this output. */
export async function completeOrder(actor: Actor, orderId: string, input: z.infer<typeof completeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  const actual = parseQtyMicro(input.actualQty);
  if (actual === null || actual === 0n) throw invalid("actualQty", "mfg.e.qty");
  if (actual > MAX_MOVEMENT_MICRO) throw invalid("actualQty", "mfg.e.qty_big");
  let waste: bigint | null = null;
  if (input.wasteQty && input.wasteQty.trim() !== "") {
    waste = parseQtyMicro(input.wasteQty);
    if (waste === null) throw invalid("wasteQty", "mfg.e.qty");
    if (waste > MAX_MOVEMENT_MICRO) throw invalid("wasteQty", "mfg.e.qty_big");
  }
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "ISSUED") throw invalid("orderId", "mfg.e.order_state");
    await tx.productionOrder.update({
      where: { id: orderId },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.userId, actualQtyMicro: actual, wasteQtyMicro: waste, wasteNote: input.wasteNote },
    });
  });
  await recordMfg(actor, order.workspaceId, "order_completed", orderId, { seq: order.seq, actualMicro: num(actual) });
  return readOrderIn(scope, orderId);
}

/** «إلغاء»: a DRAFT is cancelled (nothing was taken, so nothing moves). After the issue the way back is «إرجاع المواد». */
export async function cancelOrder(actor: Actor, orderId: string, input: z.infer<typeof closeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "DRAFT") throw invalid("orderId", "mfg.e.order_state");
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "CANCELLED", closedAt: new Date(), closedById: actor.userId, closeNote: input.reason } });
  });
  await recordMfg(actor, order.workspaceId, "order_cancelled", orderId, { seq: order.seq, reason: input.reason });
  return readOrderIn(scope, orderId);
}

/**
 * «إرجاع المواد»: ISSUED → RETURNED. Every movement the issue wrote is reversed by a new movement (the opposite quantity and value, pointing at
 * the original, linked to the order); the originals stay. All of it or none of it, under the materials' row locks. A completed order cannot be returned.
 */
export async function returnOrder(actor: Actor, orderId: string, input: z.infer<typeof closeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "ISSUED") throw invalid("orderId", "mfg.e.order_state");
    await lockMaterials(tx, fresh.lines.map((l) => l.materialId));
    const links = await tx.productionOrderMovement.findMany({ where: { orderId }, select: { lineId: true, movement: true } });
    const reversed = new Set((await tx.materialMovement.findMany({ where: { reversesId: { in: links.map((l) => l.movement.id) } }, select: { reversesId: true } })).map((m) => m.reversesId));
    const touched = new Set<string>();
    for (const link of links) {
      const original = link.movement;
      if (original.kind !== "ISSUE" || reversed.has(original.id)) continue;
      const back = await tx.materialMovement.create({
        data: {
          orgId: actor.orgId,
          workspaceId: order.workspaceId,
          materialId: original.materialId,
          lotId: original.lotId,
          kind: "REVERSE",
          qtyMicro: -original.qtyMicro,
          valueMinor: -original.valueMinor,
          reason: `إرجاع أمر تصنيع رقم ${order.seq}: ${input.reason}`.slice(0, LIMITS.reason),
          reversesId: original.id,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await tx.productionOrderMovement.create({ data: { orderId, lineId: link.lineId, movementId: back.id } });
      touched.add(original.materialId);
    }
    // a material never goes over the ceiling a balance may reach, even by a return
    for (const materialId of touched) {
      const sum = await tx.materialMovement.aggregate({ where: { materialId }, _sum: { qtyMicro: true } });
      if ((sum._sum.qtyMicro ?? 0n) > MAX_BALANCE_MICRO) throw invalid(materialId, "mfg.e.qty_big");
    }
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "RETURNED", closedAt: new Date(), closedById: actor.userId, closeNote: input.reason } });
  });
  await recordMfg(actor, order.workspaceId, "order_returned", orderId, { seq: order.seq, reason: input.reason });
  return readOrderIn(scope, orderId);
}
