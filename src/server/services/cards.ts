import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import { actorCan, assertMemberCan, type Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertCanWrite } from "@/server/services/guest-guard";
import { PENDING_PATH } from "@/server/services/files";
import { createTask } from "@/server/services/tasks";
import { canPostInConversation } from "@/server/policy/conversation";
import { sendMessage } from "@/server/chat/messages";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";
import { recordCard } from "@/server/services/card-audit";
import { AR } from "@/lib/i18n/dict";
import {
  CARD_COLORS,
  GENERIC_CARD_KINDS,
  KNOWLEDGE_KINDS,
  LIMITS,
  cardMessageText,
  cardTaskDescription,
  cleanCardData,
  cleanCategory,
  cleanTags,
  isCardColor,
  isCardKind,
  type CardData,
  type CardItem,
  type CardKind,
} from "@/lib/cards/shared";
import { POSITION_STEP, positionBetween, positionOnTop } from "@/lib/cards/order";
import { statusOf } from "@/lib/cards/status";
import { SNAPSHOT_FIELDS, changedFields, decideSave, type CardSnapshot, type SnapshotField } from "@/lib/cards/versions";

/**
 * «اللوحات» — the cards of a space. ONE place decides who may do what with them:
 *
 *  - a person outside the space gets «not found» for its cards, never «forbidden» (the space is invisible to them);
 *  - the people in the space read and write; an external partner (GUEST) reads only, and never sees a FILE card (the file
 *    library is closed to them, so a card that opens a library file is too); somebody whose «المكتبة» box is off does not
 *    see FILE cards either;
 *  - the OWNER reads everywhere, silently (no row, no trace), and alone reads the archive;
 *  - nothing is ever hard-deleted: «حذف» sets `archivedAt`;
 *  - every query carries the company AND the space.
 */

// ---------- who is asking, about which space ----------

export interface CardScope {
  actor: Actor;
  spaceId: string;
  /** May create, edit, archive, reorder, send. */
  canWrite: boolean;
  /** The company's OWNER: reads the archive. */
  owner: boolean;
  /** Reads FILE cards (not a guest; holds the library's «يشوف»). */
  seesFiles: boolean;
  /** Has a row in the space (the owner reading silently has none): only these leave stars and notes. */
  member: boolean;
  /** Moderates the space: its ADMIN, an org ADMIN who is in it, the OWNER. */
  manager: boolean;
}

/** The space's cards are the caller's to open, or they do not exist (404). */
export async function cardScope(actor: Actor, spaceId: string): Promise<CardScope> {
  const reachable = await accessibleWorkspaceIds(actor.userId);
  if (!reachable.includes(spaceId)) throw new NotFoundError("cards.not_found");
  const [space, row] = await Promise.all([
    db.workspace.findFirst({ where: { id: spaceId, organizationId: actor.orgId }, select: { id: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: actor.userId } }, select: { role: true } }),
  ]);
  // a space of another company of theirs is not this company's cards
  if (!space) throw new NotFoundError("cards.not_found");
  return {
    actor,
    spaceId,
    canWrite: canWriteInWorkspace(actor.role, row?.role),
    owner: actor.isOwner,
    seesFiles: !actor.isExternal && actorCan(actor, "files.view"),
    member: !!row && !actor.isExternal && row.role !== "GUEST",
    manager: isSpaceManager(actor.role, row?.role),
  };
}

export function assertWrite(scope: CardScope): void {
  assertCanWrite({ orgRole: scope.actor.role });
  if (!scope.canWrite) throw new ForbiddenError("cards.readonly");
}

// ---------- shapes ----------

export const CARD_SELECT = {
  id: true,
  orgId: true,
  workspaceId: true,
  kind: true,
  title: true,
  body: true,
  data: true,
  color: true,
  category: true,
  tags: true,
  pinned: true,
  position: true,
  fileId: true,
  archivedAt: true,
  status: true,
  version: true,
  coverFileId: true,
  external: true,
  approvedVersion: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: { select: { name: true } },
  file: { select: { name: true, mimeType: true, size: true, deletedAt: true } },
} satisfies Prisma.CardSelect;

export type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;

export function toItem(row: CardRow): CardItem {
  const kind = isCardKind(row.kind) ? row.kind : "NOTE";
  const live = row.file && !row.file.deletedAt ? { name: row.file.name, mimeType: row.file.mimeType, size: row.file.size } : null;
  return {
    id: row.id,
    kind,
    title: row.title,
    body: row.body,
    // what is stored is cleaned again on the way out: a row written some other way is never trusted (a link stays https)
    data: dataOf(kind, row.data),
    color: isCardColor(row.color) ? row.color : "none",
    category: row.category,
    tags: row.tags,
    pinned: row.pinned,
    position: row.position,
    fileId: row.fileId,
    file: live,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    createdByName: row.createdBy.name,
    status: statusOf(row.status),
    version: row.version,
    coverFileId: row.coverFileId,
  };
}

export function dataOf(kind: CardKind, raw: unknown): CardData {
  const cleaned = cleanCardData(kind, raw);
  if (cleaned.ok) return cleaned.value;
  // a damaged row shows as an empty one of its kind (a link with a bad address shows no link at all)
  return kind === "LIST" ? { items: [] } : kind === "TABLE" ? { columns: [""], rows: [] } : null; // a damaged PRODUCT row reads as none
}

export const jsonOf = (data: CardData): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  data === null ? Prisma.DbNull : (data as unknown as Prisma.InputJsonValue);

// ---------- what a request may carry ----------

const text = (max: number) => z.string().max(max);

export const createCardSchema = z.object({
  spaceId: z.string().min(1),
  kind: z.enum(GENERIC_CARD_KINDS),
  title: z.string().trim().min(1, "cards.e.title").max(LIMITS.title),
  body: text(LIMITS.body).nullable().optional(),
  data: z.unknown().optional(),
  color: z.enum(CARD_COLORS).optional(),
  category: text(200).nullable().optional(),
  tags: z.array(z.string().max(200)).max(50).optional(),
  pinned: z.boolean().optional(),
  fileId: z.string().min(1).max(64).nullable().optional(),
});
export type CreateCardInput = z.infer<typeof createCardSchema>;

export const updateCardSchema = z
  .object({
    /** The version the editor started from: a card that moved on answers 409 with the current card. */
    version: z.number().int().min(1),
    title: z.string().trim().min(1, "cards.e.title").max(LIMITS.title),
    body: text(LIMITS.body).nullable(),
    data: z.unknown(),
    color: z.enum(CARD_COLORS),
    category: text(200).nullable(),
    tags: z.array(z.string().max(200)).max(50),
    pinned: z.boolean(),
    fileId: z.string().min(1).max(64).nullable(),
  })
  .partial();
export type UpdateCardInput = z.infer<typeof updateCardSchema>;

export const moveCardSchema = z.object({
  previousId: z.string().min(1).max(64).nullable().optional(),
  nextId: z.string().min(1).max(64).nullable().optional(),
});
export type MoveCardInput = z.infer<typeof moveCardSchema>;

export const sendCardSchema = z.object({ conversationId: z.string().min(1).max(64) });

export const cardTaskSchema = z.object({
  projectId: z.string().min(1).max(64),
  boardId: z.string().min(1).max(64),
  columnId: z.string().min(1).max(64).optional(),
});

function cleanBody(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.trim().length ? raw : null;
}

function dataOrRefuse(kind: CardKind, raw: unknown): CardData {
  const cleaned = cleanCardData(kind, raw);
  if (!cleaned.ok) throw new ValidationError([{ path: "data", message: cleaned.error }]);
  return cleaned.value;
}

/** A file a FILE card points at: a library file of THIS space, finished, current, not deleted. */
export async function assertCardFile(scope: CardScope, fileId: string): Promise<void> {
  if (!scope.seesFiles) throw new ForbiddenError("section.view_denied");
  const file = await db.storedFile.findFirst({
    where: {
      id: fileId,
      orgId: scope.actor.orgId,
      workspaceId: scope.spaceId,
      purpose: "LIBRARY",
      isLatest: true,
      deletedAt: null,
      path: { not: PENDING_PATH },
    },
    select: { id: true },
  });
  if (!file) throw new NotFoundError("cards.file_not_found");
}

// ---------- reading ----------

export interface CardList {
  cards: CardItem[];
  canWrite: boolean;
  owner: boolean;
}

/** The space's cards in manual order, pinned first. `archived`: the OWNER's «المحذوفات». */
export async function listCards(actor: Actor, spaceId: string, opts: { archived?: boolean } = {}): Promise<CardList> {
  const scope = await cardScope(actor, spaceId);
  if (opts.archived && !scope.owner) throw new ForbiddenError("cards.archive_owner_only");
  const rows = await db.card.findMany({
    where: {
      orgId: actor.orgId,
      workspaceId: spaceId,
      archivedAt: opts.archived ? { not: null } : null,
      // the company's knowledge (PRODUCT, REPLY) is not an ordinary card of the space: it has its own door (services/knowledge.ts)
      kind: { notIn: scope.seesFiles ? [...KNOWLEDGE_KINDS] : ["FILE", ...KNOWLEDGE_KINDS] },
    },
    orderBy: opts.archived ? [{ archivedAt: "desc" }, { id: "asc" }] : [{ pinned: "desc" }, { position: "asc" }, { id: "asc" }],
    take: LIMITS.cards,
    select: CARD_SELECT,
  });
  return { cards: rows.map(toItem), canWrite: scope.canWrite, owner: scope.owner };
}

/** A card the caller may touch: its space is theirs, its kind is one they see, and an archived one is the owner's. */
export async function loadCard(actor: Actor, cardId: string, opts: { knowledge?: boolean } = {}): Promise<{ scope: CardScope; row: CardRow }> {
  const row = await db.card.findFirst({ where: { id: cardId, orgId: actor.orgId }, select: CARD_SELECT });
  if (!row) throw new NotFoundError("cards.not_found");
  // a product sheet or a general answer is read and written only through the knowledge door, which knows who may see an unapproved one
  if (!opts.knowledge && (row.kind === "PRODUCT" || row.kind === "REPLY")) throw new NotFoundError("cards.not_found");
  const scope = await cardScope(actor, row.workspaceId);
  if (row.kind === "FILE" && !scope.seesFiles) throw new NotFoundError("cards.not_found");
  if (row.archivedAt && !scope.owner) throw new NotFoundError("cards.not_found");
  return { scope, row };
}

export async function readCard(actor: Actor, cardId: string): Promise<CardItem> {
  return toItem((await loadCard(actor, cardId)).row);
}

// ---------- writing ----------

export async function createCard(actor: Actor, input: CreateCardInput): Promise<CardItem> {
  const scope = await cardScope(actor, input.spaceId);
  assertWrite(scope);
  const kind: CardKind = input.kind;
  const body = cleanBody(input.body);
  if (kind === "PROMPT" && !body) throw new ValidationError([{ path: "body", message: "cards.e.prompt" }]);
  const data = dataOrRefuse(kind, input.data);
  let fileId: string | null = null;
  if (kind === "FILE") {
    if (!input.fileId) throw new ValidationError([{ path: "fileId", message: "cards.e.file" }]);
    await assertCardFile(scope, input.fileId);
    fileId = input.fileId;
  }

  const first = await db.card.findFirst({
    where: { workspaceId: input.spaceId, archivedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { position: true },
  });
  const row = await db.card.create({
    data: {
      orgId: actor.orgId,
      workspaceId: input.spaceId,
      createdById: actor.userId,
      kind,
      title: input.title,
      body,
      data: jsonOf(data),
      color: input.color ?? "none",
      category: cleanCategory(input.category),
      tags: cleanTags(input.tags),
      pinned: input.pinned === true,
      position: positionOnTop(first?.position),
      fileId,
    },
    select: CARD_SELECT,
  });
  await recordCard(actor, row, "created", { kind });
  return toItem(row);
}

/** The card moved on since the editor started: the answer is 409, carrying the card as it is now. */
export class CardConflictError extends Error {
  constructor(readonly card: CardItem) {
    super("cards.conflict");
    this.name = "CardConflictError";
  }
}

function snapshotOf(row: Pick<CardRow, "kind" | "title" | "body" | "data" | "color" | "category" | "tags" | "fileId">): CardSnapshot {
  return {
    title: row.title,
    body: row.body,
    data: dataOf(row.kind as CardKind, row.data),
    color: row.color,
    category: row.category,
    tags: row.tags,
    fileId: row.fileId,
  };
}

export interface SavedEdit {
  card: CardItem;
  /** A new version was written (false: nothing changed, or only the pin). */
  applied: boolean;
  changed: SnapshotField[];
  pinChanged: boolean;
}

/**
 * ONE place writes a card's content, so every save is versioned the same way: the card row is locked, the editor's
 * starting version is compared with the card's (409 if the card moved on), the snapshot BEFORE the edit is appended to
 * `CardRevision`, and the card moves to the next version, all in one transaction. A save that changes nothing writes
 * nothing; the pin is not content and never makes a version.
 */
export async function saveCardEdit(
  actor: Actor,
  cardId: string,
  patch: Partial<CardSnapshot>,
  opts: { baseVersion?: number | null; pinned?: boolean; alsoOnApply?: (fresh: CardRow) => Prisma.CardUpdateInput } = {},
): Promise<SavedEdit> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Card" WHERE "id" = ${cardId} AND "orgId" = ${actor.orgId} FOR UPDATE`;
    const fresh = await tx.card.findFirst({ where: { id: cardId, orgId: actor.orgId }, select: CARD_SELECT });
    if (!fresh || fresh.archivedAt) throw new NotFoundError("cards.not_found");
    const changed = changedFields(snapshotOf(fresh), patch);
    const decision = decideSave({ baseVersion: opts.baseVersion, currentVersion: fresh.version, changed });
    if (decision.kind === "conflict") throw new CardConflictError(toItem(fresh));

    const data: Prisma.CardUpdateInput = {};
    const pinChanged = opts.pinned !== undefined && opts.pinned !== fresh.pinned;
    if (pinChanged) data.pinned = opts.pinned;
    if (decision.kind === "apply") {
      const before = snapshotOf(fresh);
      await tx.cardRevision.create({
        data: {
          cardId,
          version: fresh.version,
          title: before.title,
          body: before.body,
          data: jsonOf(before.data as CardData),
          color: before.color,
          category: before.category,
          tags: before.tags,
          fileId: before.fileId,
          editorId: actor.userId,
        },
      });
      for (const field of changed) {
        if (field === "title") data.title = patch.title as string;
        else if (field === "body") data.body = patch.body ?? null;
        else if (field === "data") data.data = jsonOf(patch.data as CardData);
        else if (field === "color") data.color = patch.color as string;
        else if (field === "category") data.category = patch.category ?? null;
        else if (field === "tags") data.tags = patch.tags as string[];
        else if (field === "fileId") data.file = patch.fileId ? { connect: { id: patch.fileId } } : { disconnect: true };
      }
      data.version = { increment: 1 };
      // what the same transaction must also write when the edit is applied (the knowledge door's status and approved version)
      if (opts.alsoOnApply) Object.assign(data, opts.alsoOnApply(fresh));
    }
    if (Object.keys(data).length === 0) return { card: toItem(fresh), applied: false, changed, pinChanged };
    const updated = await tx.card.update({ where: { id: cardId }, data, select: CARD_SELECT });
    return { card: toItem(updated), applied: decision.kind === "apply", changed, pinChanged };
  });
}

export async function updateCard(actor: Actor, cardId: string, input: UpdateCardInput): Promise<CardItem> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  // an archived card is the owner's to read; changing it goes through «استرجاع» first
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const kind = row.kind as CardKind;
  const patch: Partial<CardSnapshot> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) {
    const body = cleanBody(input.body);
    if (kind === "PROMPT" && !body) throw new ValidationError([{ path: "body", message: "cards.e.prompt" }]);
    patch.body = body;
  }
  if (input.data !== undefined) patch.data = dataOrRefuse(kind, input.data);
  if (input.color !== undefined) patch.color = input.color;
  if (input.category !== undefined) patch.category = cleanCategory(input.category);
  if (input.tags !== undefined) patch.tags = cleanTags(input.tags);
  // only a FILE card has a file: for any other kind a null `fileId` (what the editor always sends) means «none», and is ignored
  if (input.fileId !== undefined && !(kind !== "FILE" && input.fileId === null)) {
    if (kind !== "FILE" || !input.fileId) throw new ValidationError([{ path: "fileId", message: "cards.e.file" }]);
    // the file the card already points at stays valid; a different one must be a library file of this space
    if (input.fileId !== row.fileId) await assertCardFile(scope, input.fileId);
    patch.fileId = input.fileId;
  }
  const saved = await saveCardEdit(actor, cardId, patch, { baseVersion: input.version, pinned: input.pinned });
  if (saved.applied) await recordCard(actor, row, "edited", { version: saved.card.version ?? 0, fields: saved.changed });
  if (saved.pinChanged) await recordCard(actor, row, "pinned", { pinned: saved.card.pinned });
  return saved.card;
}

/** «حذف»: the card goes out of sight; the OWNER still reads it under «المحذوفات». Nothing is removed. */
export async function archiveCard(actor: Actor, cardId: string): Promise<void> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) return;
  await db.card.update({ where: { id: cardId }, data: { archivedAt: new Date() } });
  await recordCard(actor, row, "archived");
}

/** «استرجاع»: the OWNER brings an archived card back (to the top of the manual order). */
export async function restoreCard(actor: Actor, cardId: string): Promise<CardItem> {
  const { scope, row } = await loadCard(actor, cardId);
  if (!scope.owner) throw new ForbiddenError("cards.archive_owner_only");
  if (!row.archivedAt) return toItem(row);
  const first = await db.card.findFirst({
    where: { workspaceId: row.workspaceId, archivedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { position: true },
  });
  const updated = await db.card.update({
    where: { id: cardId },
    data: { archivedAt: null, position: positionOnTop(first?.position) },
    select: CARD_SELECT,
  });
  await recordCard(actor, row, "unarchived");
  return toItem(updated);
}

/** The cards of a space with their places, ready to renumber one by one (never used unless two places have met). */
async function renumberSpace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Card" AS c SET "position" = ranked.n * ${POSITION_STEP}
    FROM (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "position" ASC, "id" ASC) AS n
      FROM "Card" WHERE "workspaceId" = ${workspaceId} AND "archivedAt" IS NULL
    ) AS ranked
    WHERE c."id" = ranked."id"`;
}

async function positionOf(tx: Prisma.TransactionClient, cardId: string): Promise<number> {
  return (await tx.card.findUniqueOrThrow({ where: { id: cardId }, select: { position: true } })).position;
}

/** «نسخة»: a copy right after the original (unpinned), pointing at the same file when it is a FILE card. */
export async function duplicateCard(actor: Actor, cardId: string): Promise<CardItem> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const title = `${row.title} (${AR["cards.copy_suffix"] ?? ""})`.slice(0, LIMITS.title);
  const created = await db.$transaction(async (tx) => {
    const place = async () => {
      const here = await positionOf(tx, row.id);
      const next = await tx.card.findFirst({
        where: { workspaceId: row.workspaceId, archivedAt: null, id: { not: row.id }, position: { gt: here } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { position: true },
      });
      return positionBetween(here, next?.position);
    };
    let position = await place();
    if (position === null) {
      await renumberSpace(tx, row.workspaceId);
      position = (await place()) ?? POSITION_STEP;
    }
    return tx.card.create({
      data: {
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        createdById: actor.userId,
        kind: row.kind,
        title,
        body: row.body,
        data: jsonOf(dataOf(row.kind as CardKind, row.data)),
        color: row.color,
        category: row.category,
        tags: row.tags,
        pinned: false,
        position,
        fileId: row.fileId,
      },
      select: CARD_SELECT,
    });
  });
  await recordCard(actor, created, "created", { copyOf: row.id });
  return toItem(created);
}

/**
 * Drag and drop: the card goes between `previousId` (above it) and `nextId` (below it). One row is written. Only when
 * the two neighbours have no number between them (equal, or touching after many halvings) is the space renumbered, once.
 */
export async function moveCard(actor: Actor, cardId: string, input: MoveCardInput): Promise<{ position: number }> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const wanted = [input.previousId, input.nextId].filter((id): id is string => typeof id === "string");
  if (wanted.includes(cardId) || (wanted.length === 2 && wanted[0] === wanted[1])) {
    throw new ValidationError([{ path: "previousId", message: "cards.e.move" }]);
  }
  return db.$transaction(async (tx) => {
    const neighbours = async () => {
      const found = wanted.length
        ? await tx.card.findMany({
            where: { id: { in: wanted }, orgId: actor.orgId, workspaceId: row.workspaceId, archivedAt: null },
            select: { id: true, position: true },
          })
        : [];
      // a neighbour from another space, another company, or the archive is not one: the card cannot be put next to it
      if (found.length !== wanted.length) throw new NotFoundError("cards.not_found");
      const at = (id: string | null | undefined) => (id ? found.find((c) => c.id === id)?.position : undefined);
      return positionBetween(at(input.previousId), at(input.nextId));
    };
    let position = await neighbours();
    if (position === null) {
      await renumberSpace(tx, row.workspaceId);
      position = await neighbours();
      if (position === null) throw new ValidationError([{ path: "previousId", message: "cards.e.move" }]);
    }
    await tx.card.update({ where: { id: cardId }, data: { position } });
    return { position };
  });
}

// ---------- sending a card on ----------

/** The topics of the SAME space the caller may write in (the list «أرسل» offers). */
export async function postableTopics(actor: Actor, spaceId: string): Promise<Array<{ id: string; title: string; emoji: string | null }>> {
  const scope = await cardScope(actor, spaceId);
  assertWrite(scope);
  const topics = await db.conversation.findMany({
    where: { orgId: actor.orgId, spaceId, kind: "TOPIC", archivedAt: null, closedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, title: true, emoji: true },
  });
  const out: Array<{ id: string; title: string; emoji: string | null }> = [];
  for (const t of topics) {
    if (await canPostInConversation(actor.userId, t.id)) out.push({ id: t.id, title: t.title ?? "", emoji: t.emoji });
  }
  return out;
}

/**
 * «أرسل»: the card's title and words become a message in a topic of the SAME space, through the chat's own send path
 * (so its rules apply: closed topics, posting policy, mutes, the rate limit). Never a file: only words.
 */
export async function sendCard(actor: Actor, cardId: string, conversationId: string): Promise<{ messageId: string }> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  const topic = await db.conversation.findFirst({
    where: { id: conversationId, orgId: actor.orgId, spaceId: row.workspaceId, kind: "TOPIC" },
    select: { id: true },
  });
  if (!topic) throw new NotFoundError("cards.topic_not_found");
  const ctx: OrgAccessContext = { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
  const message = await sendMessage(ctx, topic.id, { body: cardMessageText(toItem(row)) });
  // remembered, so the card's page can link to where it went (and only show the link to people who may read that topic)
  await recordCard(actor, row, "sent", { conversationId: topic.id, messageId: message.id });
  return { messageId: message.id };
}

/** «حوّلها لمهمة»: a task of a project of the SAME space, through the task service (its rules apply). */
export async function cardToTask(actor: Actor, cardId: string, target: z.infer<typeof cardTaskSchema>): Promise<{ taskId: string }> {
  const { scope, row } = await loadCard(actor, cardId);
  assertWrite(scope);
  if (row.archivedAt) throw new NotFoundError("cards.not_found");
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const item = toItem(row);
  const task = await createTask(
    { userId: actor.userId, orgId: actor.orgId },
    {
      // the project must belong to the card's space: `createTask` binds project, space and company together
      workspaceId: row.workspaceId,
      projectId: target.projectId,
      boardId: target.boardId,
      columnId: target.columnId,
      title: item.title.slice(0, 280),
      description: cardTaskDescription(item),
    },
  );
  await recordCard(actor, row, "task", { taskId: task.id });
  return { taskId: task.id };
}
