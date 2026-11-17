import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { CARD_SELECT, cardScope, saveCardEdit, CardConflictError, type CardRow, type CardScope } from "@/server/services/cards";
import { recordCard } from "@/server/services/card-audit";
import { KNOWLEDGE_KINDS, LIMITS, cleanCardData, cleanCategory } from "@/lib/cards/shared";
import { positionOnTop } from "@/lib/cards/order";
import { canMoveStatus, statusOf, CARD_STATUSES, type CardStatus } from "@/lib/cards/status";
import { cleanProductData, sheetGaps, type GapKey, type ProductBadge, type ProductData } from "@/lib/cards/knowledge";
import { DELIVERY_LINE_MAX, knowledgeSettingsOf, type KnowledgeSettings } from "@/lib/cards/knowledge-settings";
import { cleanSpecs, emptyProductData, templateFor, type TemplateOverrides } from "@/lib/cards/product-templates";
import { applyOldCard, parseOldCard } from "@/lib/cards/old-card-parser";
import { isStale, type OfferSnapshot, type ProductSnapshot } from "@/lib/oms/snapshot";
import { foldForSearch } from "@/lib/search/arabic";
import { createInstantTicket } from "@/server/services/tickets";

/**
 * «المنتجات» — the company's product sheets (Q1.1): ONE door for the PRODUCT cards of the knowledge space.
 *
 *  - WHO COMES IN: staff who are members of the knowledge space. An external partner never (404), nobody while the switch `knowledgeCards`
 *    is off (404).
 *  - WHO WRITES: the space's managers and the people the owner named as editors (`knowledgeEditorIds`). WHO APPROVES: the owner and the
 *    people he named (`knowledgeApproverIds`) — the D-Q4 default.
 *  - WHAT A READER WHO IS NOT AN EDITOR SEES: only a sheet that was approved, and ALWAYS its last APPROVED version (the card itself when
 *    its version is the approved one, else that CardRevision) together with the LIVE snapshot of the orders system. An edit by an editor
 *    who may not approve waits in «قيد المراجعة» and the old version keeps being served.
 *  - THE CAUTION is the team's: only an editor is ever sent it.
 *  - THE PRICE is never typed here: it is `Card.external`, written by the sync (Q1.0). Every staff reader who may read the sheet sees it.
 */

// ---------- who is asking ----------

interface Ctx {
  actor: Actor;
  scope: CardScope;
  settings: KnowledgeSettings;
  spaceId: string;
  editor: boolean;
  approver: boolean;
}

async function settingsOfOrg(orgId: string): Promise<KnowledgeSettings> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return knowledgeSettingsOf(org?.settings ?? {});
}

/** Staff only: an external partner or a guest is told the page does not exist. */
function assertStaff(actor: Actor): void {
  if (actor.isExternal || actor.role === "GUEST") throw new NotFoundError("features.off");
}

async function context(actor: Actor): Promise<Ctx> {
  assertStaff(actor);
  await assertFeatureOn(actor.orgId, "knowledgeCards");
  const settings = await settingsOfOrg(actor.orgId);
  if (!settings.spaceId) throw new NotFoundError("knowledge.no_space");
  const scope = await cardScope(actor, settings.spaceId);
  // a guest of the SPACE (not of the company) is not staff here either
  if (!scope.member && !scope.owner && !scope.manager) throw new NotFoundError("cards.not_found");
  const approver = actor.isOwner || settings.approverIds.includes(actor.userId);
  const editor = scope.canWrite && (scope.manager || approver || settings.editorIds.includes(actor.userId));
  return { actor, scope, settings, spaceId: settings.spaceId, editor, approver: approver && scope.canWrite };
}

function assertEditor(ctx: Ctx): void {
  if (!ctx.editor) throw new ForbiddenError("knowledge.readonly");
}

// ---------- shapes ----------

export interface ExternalView {
  price: number;
  currency: string;
  offers: OfferSnapshot[];
  stockStatus: string;
  deliveryIncluded?: boolean;
  link?: string;
  store?: string;
  fetchedAt: string;
  /** Older than 30 minutes: the screen refuses to copy a price. */
  stale: boolean;
  /** The product is gone from the orders system. */
  missingSince?: string;
}

export interface SheetDTO {
  id: string;
  name: string;
  category: string | null;
  data: ProductData | null;
  external: ExternalView | null;
  status: CardStatus;
  version: number;
  approvedVersion: number | null;
  canEdit: boolean;
  canApprove: boolean;
  /** For editors only. */
  gaps?: GapKey[];
  /** For editors only: how many times the sheet was copied from. */
  copies?: number;
  deliveryLine: string;
  /** What the owner's templates say for this category (the editor offers these sections). */
  templateSections: Array<{ key: string; title: string; kind: string }>;
  unit: string;
  hasCover: boolean;
}

export interface SheetListItem {
  id: string;
  name: string;
  category: string | null;
  tagline: string;
  badges: ProductBadge[];
  stockStatus: string | null;
  price: number | null;
  currency: string | null;
  stale: boolean;
  missing: boolean;
  status: CardStatus;
  /** For editors only. */
  gaps?: GapKey[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function externalOf(raw: unknown, now: Date): ExternalView | null {
  if (!isObj(raw) || typeof raw["price"] !== "number") return null;
  const snap = raw as unknown as ProductSnapshot;
  return {
    price: snap.price,
    currency: typeof snap.currency === "string" ? snap.currency : "",
    offers: Array.isArray(snap.offers) ? snap.offers : [],
    stockStatus: typeof snap.stockStatus === "string" ? snap.stockStatus : "unknown",
    ...(typeof snap.deliveryIncluded === "boolean" ? { deliveryIncluded: snap.deliveryIncluded } : {}),
    ...(typeof snap.link === "string" ? { link: snap.link } : {}),
    ...(typeof snap.store === "string" ? { store: snap.store } : {}),
    fetchedAt: String(snap.fetchedAt ?? ""),
    stale: isStale(snap, now),
    ...(typeof snap.missingSince === "string" ? { missingSince: snap.missingSince } : {}),
  };
}

/** What a reader who is not an editor is served: the approved version of a sheet, or null when nothing was approved. */
interface Served {
  title: string;
  category: string | null;
  data: ProductData | null;
  coverFileId: string | null;
}

function productData(raw: unknown): ProductData | null {
  const r = cleanProductData(raw);
  return r.ok ? r.value : null;
}

async function servedOf(row: CardRow): Promise<Served | null> {
  if (row.approvedVersion === null) return null;
  if (row.version === row.approvedVersion) return { title: row.title, category: row.category, data: productData(row.data), coverFileId: row.coverFileId };
  const rev = await db.cardRevision.findUnique({ where: { cardId_version: { cardId: row.id, version: row.approvedVersion } } });
  if (!rev) return null;
  return { title: rev.title, category: rev.category, data: productData(rev.data), coverFileId: row.coverFileId };
}

async function loadSheet(ctx: Ctx, cardId: string): Promise<CardRow> {
  const row = await db.card.findFirst({ where: { id: cardId, orgId: ctx.actor.orgId, workspaceId: ctx.spaceId, kind: "PRODUCT" }, select: CARD_SELECT });
  if (!row || row.archivedAt) throw new NotFoundError("cards.not_found");
  // a reader who is not an editor never knows a sheet nobody approved exists
  // (an archived sheet is taken away from readers too, and returns with its approved version when it is un-archived)
  if (!ctx.editor && (row.approvedVersion === null || statusOf(row.status) === "ARCHIVED")) throw new NotFoundError("cards.not_found");
  return row;
}

async function toSheet(ctx: Ctx, row: CardRow, now: Date): Promise<SheetDTO> {
  let name = row.title;
  let category = row.category;
  let data = productData(row.data);
  if (!ctx.editor) {
    const served = await servedOf(row);
    if (!served) throw new NotFoundError("cards.not_found");
    name = served.title;
    category = served.category;
    // the caution is the team's: a reader is never sent it
    data = served.data ? (({ caution: _c, ...rest }) => rest as ProductData)(served.data) : null;
  }
  const template = templateFor(category, ctx.settings.templates);
  const base: SheetDTO = {
    id: row.id,
    name,
    category,
    data,
    external: externalOf(row.external, now),
    // a reader is never told that a newer edit waits for review: what they hold is approved
    status: ctx.editor ? statusOf(row.status) : "APPROVED",
    version: ctx.editor ? row.version : (row.approvedVersion ?? row.version),
    approvedVersion: row.approvedVersion,
    canEdit: ctx.editor,
    canApprove: ctx.approver,
    deliveryLine: ctx.settings.deliveryLine,
    templateSections: template.sections.map((s) => ({ key: s.key, title: s.title, kind: s.kind })),
    unit: template.unit,
    hasCover: !!row.coverFileId,
  };
  if (!ctx.editor) return base;
  const copies = await db.auditLog.count({ where: { orgId: ctx.actor.orgId, target: row.id, action: "card.copied" } });
  return { ...base, gaps: sheetGaps(data, { hasPhoto: !!row.coverFileId }), copies };
}

// ---------- reading ----------

export interface SheetList {
  configured: boolean;
  canEdit: boolean;
  canApprove: boolean;
  isOwner: boolean;
  sheets: SheetListItem[];
}

export async function listSheets(actor: Actor, opts: { q?: string; category?: string } = {}, now: Date = new Date()): Promise<SheetList> {
  assertStaff(actor);
  await assertFeatureOn(actor.orgId, "knowledgeCards");
  const settings = await settingsOfOrg(actor.orgId);
  if (!settings.spaceId) return { configured: false, canEdit: false, canApprove: false, isOwner: actor.isOwner, sheets: [] };
  const ctx = await context(actor).catch((err) => {
    if (err instanceof NotFoundError) return null;
    throw err;
  });
  if (!ctx) return { configured: true, canEdit: false, canApprove: false, isOwner: actor.isOwner, sheets: [] };
  const rows = await db.card.findMany({
    where: { orgId: actor.orgId, workspaceId: ctx.spaceId, kind: "PRODUCT", archivedAt: null, ...(ctx.editor ? {} : { approvedVersion: { not: null }, status: { not: "ARCHIVED" } }) },
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { id: "asc" }],
    take: LIMITS.cards,
    select: CARD_SELECT,
  });
  const needle = opts.q ? foldForSearch(opts.q).trim() : "";
  const items: SheetListItem[] = [];
  for (const row of rows) {
    let name = row.title;
    let category = row.category;
    let data = productData(row.data);
    if (!ctx.editor) {
      const served = await servedOf(row);
      if (!served) continue;
      name = served.title;
      category = served.category;
      data = served.data;
    }
    if (opts.category && category !== opts.category) continue;
    if (needle && ![name, category ?? "", data?.tagline ?? ""].some((s) => foldForSearch(s).includes(needle))) continue;
    const ext = externalOf(row.external, now);
    items.push({
      id: row.id,
      name,
      category,
      tagline: data?.tagline ?? "",
      badges: data?.badges ?? [],
      stockStatus: ext?.stockStatus ?? null,
      price: ext?.price ?? null,
      currency: ext?.currency ?? null,
      stale: ext ? ext.stale : true,
      missing: !!ext?.missingSince,
      status: ctx.editor ? statusOf(row.status) : "APPROVED",
      ...(ctx.editor ? { gaps: sheetGaps(data, { hasPhoto: !!row.coverFileId }) } : {}),
    });
  }
  return { configured: true, canEdit: ctx.editor, canApprove: ctx.approver, isOwner: actor.isOwner, sheets: items };
}

export async function readSheet(actor: Actor, cardId: string, now: Date = new Date()): Promise<SheetDTO> {
  const ctx = await context(actor);
  return toSheet(ctx, await loadSheet(ctx, cardId), now);
}

// ---------- writing ----------

export const createSheetSchema = z.object({
  title: z.string().trim().min(1, "cards.e.title").max(LIMITS.title),
  category: z.string().max(200).nullable().optional(),
  data: z.unknown().optional(),
});
// the version the editor opened is REQUIRED: a save without it would overwrite what somebody else just wrote
export const updateSheetSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().trim().min(1, "cards.e.title").max(LIMITS.title).optional(),
  category: z.string().max(200).nullable().optional(),
  data: z.unknown().optional(),
});
// approving names the version the approver saw (the server refuses to approve what he did not read)
export const sheetStatusSchema = z.object({ status: z.enum(CARD_STATUSES), version: z.number().int().min(1).optional() });
export const copySchema = z.object({ what: z.string().trim().min(1).max(40) });

function dataOrRefuse(raw: unknown): ProductData {
  const cleaned = cleanCardData("PRODUCT", raw);
  if (!cleaned.ok) throw new ValidationError([{ path: "data", message: cleaned.error }]);
  return cleaned.value as ProductData;
}

export async function createSheet(actor: Actor, input: z.infer<typeof createSheetSchema>, now: Date = new Date()): Promise<SheetDTO> {
  const ctx = await context(actor);
  assertEditor(ctx);
  const category = cleanCategory(input.category);
  const data = input.data === undefined ? emptyProductData(templateFor(category, ctx.settings.templates)) : dataOrRefuse(input.data);
  const first = await db.card.findFirst({ where: { workspaceId: ctx.spaceId, archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { position: true } });
  const row = await db.card.create({
    data: {
      orgId: actor.orgId,
      workspaceId: ctx.spaceId,
      createdById: actor.userId,
      kind: "PRODUCT",
      title: input.title,
      data: data as unknown as Prisma.InputJsonValue,
      category,
      position: positionOnTop(first?.position),
      status: "DRAFT",
    },
    select: CARD_SELECT,
  });
  await recordCard(actor, row, "created", { kind: "PRODUCT" });
  return toSheet(ctx, row, now);
}

export async function updateSheet(actor: Actor, cardId: string, input: z.infer<typeof updateSheetSchema>, now: Date = new Date()): Promise<SheetDTO> {
  const ctx = await context(actor);
  assertEditor(ctx);
  const row = await loadSheet(ctx, cardId);
  const patch: { title?: string; category?: string | null; data?: ProductData } = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.category !== undefined) patch.category = cleanCategory(input.category);
  if (input.data !== undefined) patch.data = dataOrRefuse(input.data);
  try {
    const saved = await saveCardEdit(actor, cardId, patch, {
      baseVersion: input.version,
      // an edit by an approver of an approved sheet stays approved (at the new version); by another editor it waits in review while the old
      // approved version keeps being served
      alsoOnApply: (fresh) => {
        const wasApproved = statusOf(fresh.status) === "APPROVED";
        if (!wasApproved) return {};
        return ctx.approver ? { approvedVersion: fresh.version + 1 } : { status: "REVIEW" };
      },
    });
    if (saved.applied) await recordCard(actor, row, "edited", { version: saved.card.version ?? 0, fields: saved.changed });
  } catch (err) {
    if (err instanceof CardConflictError) throw new ValidationError([{ path: "version", message: "knowledge.conflict" }]);
    throw err;
  }
  return toSheet(ctx, await loadSheet(ctx, cardId), now);
}

export async function setSheetStatus(actor: Actor, cardId: string, to: CardStatus, seenVersion?: number, now: Date = new Date()): Promise<SheetDTO> {
  const ctx = await context(actor);
  assertEditor(ctx);
  const row = await loadSheet(ctx, cardId);
  const from = statusOf(row.status);
  if (to === from) return toSheet(ctx, row, now);
  // approving and archiving are the approvers'; sending to review and back to a draft is every editor's
  if ((to === "APPROVED" || to === "ARCHIVED") && !ctx.approver) throw new ForbiddenError("knowledge.approve_only");
  // an approver approves a draft in one move
  const allowed = canMoveStatus(from, to, { moderator: true }) || (to === "APPROVED" && from === "DRAFT");
  if (!allowed) throw new ValidationError([{ path: "status", message: "cards.e.status_move" }]);
  // approving is of the version the approver SAW: if the sheet moved on, nothing is approved; the write also holds only at that version
  if (to === "APPROVED") {
    if (seenVersion === undefined) throw new ValidationError([{ path: "version", message: "knowledge.version_required" }]);
    if (seenVersion !== row.version) throw new ValidationError([{ path: "version", message: "knowledge.conflict" }]);
  }
  const moved = await db.card.updateMany({
    where: { id: cardId, orgId: actor.orgId, status: from, ...(to === "APPROVED" ? { version: row.version } : {}) },
    data: { status: to, ...(to === "APPROVED" ? { approvedVersion: row.version } : {}) },
  });
  if (moved.count === 0) throw new ValidationError([{ path: "status", message: "cards.e.status_move" }]);
  await recordCard(actor, row, "status", { from, to });
  return toSheet(ctx, await loadSheet(ctx, cardId), now);
}

/** «حذف»: out of sight for everybody; nothing is removed. */
export async function archiveSheet(actor: Actor, cardId: string): Promise<void> {
  const ctx = await context(actor);
  assertEditor(ctx);
  const row = await loadSheet(ctx, cardId);
  // taking an approved sheet away from everybody is the approvers' act, like archiving it: it is no way around the approval
  if (row.approvedVersion !== null && !ctx.approver) throw new ForbiddenError("knowledge.approve_only");
  await db.card.update({ where: { id: cardId }, data: { archivedAt: new Date() } });
  await recordCard(actor, row, "archived");
}

/** Every copy from a sheet is one line in the log, so the owner sees what is used most. Any reader may. */
export async function logCopy(actor: Actor, cardId: string, what: string): Promise<void> {
  const ctx = await context(actor);
  const row = await loadSheet(ctx, cardId);
  await recordCard(actor, row, "copied", { what });
}

// ---------- «اسألي مشرفتك» ----------

export const askSchema = z.object({ question: z.string().trim().min(3, "title.too_short").max(300) });

/**
 * Nothing in the sheet answers the question: it becomes a «تذكرة فورية» (the existing door; Q1.5 extends it) for the supervisor the owner
 * named as approver, or for the primary owner when he named none. The question is what the person typed: no customer data is added.
 */
export async function askSupervisor(actor: Actor, cardId: string, input: z.infer<typeof askSchema>): Promise<{ ticketId: string }> {
  const ctx = await context(actor);
  const row = await loadSheet(ctx, cardId);
  // the first named approver who is still active; the primary owner when there is none
  const active = ctx.settings.approverIds.length
    ? await db.organizationMember.findMany({ where: { organizationId: actor.orgId, status: "ACTIVE", role: { not: "GUEST" }, userId: { in: ctx.settings.approverIds } }, select: { userId: true } })
    : [];
  let assigneeId = ctx.settings.approverIds.find((id) => active.some((a) => a.userId === id)) ?? null;
  if (!assigneeId) {
    const owner = await db.organizationMember.findFirst({ where: { organizationId: actor.orgId, status: "ACTIVE", role: "OWNER" }, orderBy: [{ primaryOwner: "desc" }, { createdAt: "asc" }], select: { userId: true } });
    assigneeId = owner?.userId ?? null;
  }
  if (!assigneeId) throw new NotFoundError("knowledge.no_supervisor");
  const ticket = await createInstantTicket(
    { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId },
    // the name a reader holds, never a title nobody approved
    { title: `سؤال عن منتج: ${(ctx.editor ? null : (await servedOf(row))?.title) ?? row.title} — ${input.question}`.slice(0, 200), description: input.question, priority: "NORMAL", assigneeId },
  );
  return { ticketId: ticket.id };
}

// ---------- «الصقي كرت قديم» ----------

export const parseSchema = z.object({ text: z.string().max(20_000), category: z.string().max(200).nullable().optional() });

export async function parseOldCardFor(actor: Actor, input: z.infer<typeof parseSchema>) {
  const ctx = await context(actor);
  assertEditor(ctx);
  if (!input.text.trim()) throw new ValidationError([{ path: "text", message: "knowledge.e.parse" }]);
  const parsed = parseOldCard(input.text);
  const applied = applyOldCard(parsed, templateFor(cleanCategory(input.category), ctx.settings.templates));
  return { name: parsed.name, data: applied.data, overLimit: applied.overLimit, unmatched: parsed.unmatched, priceSeen: parsed.priceSeen };
}

// ---------- the owner's settings ----------

export interface KnowledgeSettingsDTO extends KnowledgeSettings {
  spaces: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
}

function assertOwner(actor: Pick<Actor, "isOwner">): void {
  if (!actor.isOwner) throw new ForbiddenError("knowledge.owner_only");
}

export async function getKnowledgeSettings(actor: Actor): Promise<KnowledgeSettingsDTO> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "knowledgeCards");
  const [settings, spaces, members] = await Promise.all([
    settingsOfOrg(actor.orgId),
    db.workspace.findMany({ where: { organizationId: actor.orgId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.organizationMember.findMany({ where: { organizationId: actor.orgId, status: "ACTIVE", role: { not: "GUEST" } }, select: { user: { select: { id: true, name: true } } } }),
  ]);
  return { ...settings, spaces, people: members.map((m) => m.user) };
}

export const knowledgeSettingsSchema = z.object({
  spaceId: z.string().min(1).max(64).nullable().optional(),
  editorIds: z.array(z.string().min(1).max(64)).max(100).optional(),
  approverIds: z.array(z.string().min(1).max(64)).max(100).optional(),
  deliveryLine: z.string().max(DELIVERY_LINE_MAX).optional(),
  templates: z.record(z.string().max(40), z.array(z.unknown()).max(8)).optional(),
});

export async function saveKnowledgeSettings(actor: Actor, input: z.infer<typeof knowledgeSettingsSchema>): Promise<KnowledgeSettingsDTO> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "knowledgeCards");
  const refuse = (path: string, message: string): never => {
    throw new ValidationError([{ path, message }]);
  };
  if (input.spaceId) {
    const space = await db.workspace.findFirst({ where: { id: input.spaceId, organizationId: actor.orgId, archivedAt: null }, select: { id: true } });
    if (!space) refuse("spaceId", "knowledge.e.space");
  }
  for (const key of ["editorIds", "approverIds"] as const) {
    const list = input[key];
    if (!list || list.length === 0) continue;
    const found = await db.organizationMember.count({ where: { organizationId: actor.orgId, status: "ACTIVE", role: { not: "GUEST" }, userId: { in: list } } });
    if (found !== new Set(list).size) refuse(key, "knowledge.e.people");
  }
  let templates: TemplateOverrides | undefined;
  if (input.templates) {
    templates = {};
    for (const [category, specs] of Object.entries(input.templates)) {
      if (category === "__proto__") continue;
      const clean = cleanSpecs(specs);
      if (!clean) refuse("templates", "knowledge.e.section");
      templates[category] = clean as never;
    }
  }
  await db.$transaction(async (tx) => {
    // the row is locked for the read-and-write, so a switch pressed at the same time still lands
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${actor.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
    const next: Record<string, unknown> = { ...(isObj(org?.settings) ? org.settings : {}) };
    if (input.spaceId !== undefined) {
      // the sheets move with the space: changing it never leaves them where nobody looks
      if (input.spaceId && input.spaceId !== next["knowledgeSpaceId"]) await tx.card.updateMany({ where: { orgId: actor.orgId, kind: { in: [...KNOWLEDGE_KINDS] } }, data: { workspaceId: input.spaceId } });
      next["knowledgeSpaceId"] = input.spaceId;
    }
    if (input.editorIds !== undefined) next["knowledgeEditorIds"] = [...new Set(input.editorIds)];
    if (input.approverIds !== undefined) next["knowledgeApproverIds"] = [...new Set(input.approverIds)];
    if (input.deliveryLine !== undefined) next["knowledgeDeliveryLine"] = input.deliveryLine.trim();
    if (templates !== undefined) next["productTemplates"] = templates;
    await tx.organization.update({ where: { id: actor.orgId }, data: { settings: next as Prisma.InputJsonValue } });
  });
  return getKnowledgeSettings(actor);
}
