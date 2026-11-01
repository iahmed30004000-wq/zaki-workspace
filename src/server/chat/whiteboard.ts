import { Prisma } from "@prisma/client";
import type { OrgAccessContext } from "@/server/auth";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import { db } from "@/server/db";
import { emitRealtime } from "@/server/realtime/emit";
import { canPost, canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { assertFeatureOn } from "@/server/services/features";

/**
 * THE WHITEBOARD OF A CONVERSATION («الصبورة», the owner's ask of 2026-10-25). Excalidraw (MIT) draws in the browser;
 * here is only its list of elements, one board per conversation. The same rules as the conversation's messages:
 * whoever reads it sees the board (the OWNER silently, like everything), whoever may write there draws.
 *
 * Several people draw at once: each screen sends the elements it changed, and the board keeps, per element, the newer
 * edit (Excalidraw's own rule: the higher `version`, and on a tie the lower `versionNonce`), so nobody's stroke wipes
 * another's. Every save is one `whiteboard.changed` event; the other screens fetch and merge.
 */

/** At most this many elements on one board, and in one save. */
export const MAX_ELEMENTS = 5000;
/**
 * …and at most this much on one board (the bytes of its elements as JSON). The count alone is not a
 * bound: one element may carry any text it likes, so a board could grow by a whole save at a time
 * until the database held gigabytes of it. Same ceiling as one save.
 */
export const MAX_BOARD_BYTES = 4 * 1024 * 1024;
/** Pictures are not drawn on the board (their bytes would need the files service): those elements are dropped. */
const REFUSED_TYPES = new Set(["image", "embeddable", "iframe"]);

export interface BoardElement {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  isDeleted?: boolean;
  type?: string;
  [key: string]: unknown;
}

export interface WhiteboardDto {
  conversationId: string;
  elements: BoardElement[];
  version: number;
  canDraw: boolean;
}

function isElement(value: unknown): value is BoardElement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && v["id"].length > 0 && v["id"].length <= 64 && Number.isInteger(v["version"]) && Number.isInteger(v["versionNonce"]);
}

/** The elements a client sent, checked: well formed, no pictures, not too many. */
export function cleanElements(input: unknown): BoardElement[] {
  if (!Array.isArray(input)) throw new ValidationError([{ path: "elements", message: "an array" }]);
  if (input.length > MAX_ELEMENTS) throw new ValidationError([{ path: "elements", message: "whiteboard.e.too_big" }]);
  return input.filter(isElement).filter((e) => !REFUSED_TYPES.has(String(e.type ?? "")));
}

/** Does `incoming` replace `current`? Excalidraw's own rule: the newer edit, a tie broken by the nonce. */
export function isNewer(incoming: BoardElement, current: BoardElement | undefined): boolean {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return incoming.versionNonce < current.versionNonce;
}

/** One board's elements and the changed ones of a save, merged element by element, in drawing order. */
export function mergeElements(current: BoardElement[], incoming: BoardElement[]): BoardElement[] {
  const byId = new Map(current.map((e) => [e.id, e] as const));
  for (const e of incoming) if (isNewer(e, byId.get(e.id))) byId.set(e.id, e);
  const out = [...byId.values()];
  // the drawing order is Excalidraw's fractional `index` (plain string order); an element without one keeps its place
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const x = typeof a.e.index === "string" ? a.e.index : null;
      const y = typeof b.e.index === "string" ? b.e.index : null;
      if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}

async function audience(ctx: OrgAccessContext, conversationId: string) {
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  // another company's conversation does not exist for this viewer
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  return { facts, canDraw: !!org && canPost(facts, org, { ownerJoined: facts.viewerIsMember }) };
}

/** The board of a conversation (an empty one before anybody drew). Its readers. */
export async function whiteboardOf(ctx: OrgAccessContext, conversationId: string): Promise<WhiteboardDto> {
  // «السبورة» off (or «وضع التوفير»): there is no board to read, and the stored one stays untouched
  await assertFeatureOn(ctx.orgId, "whiteboard");
  const { canDraw } = await audience(ctx, conversationId);
  const row = await db.whiteboard.findUnique({ where: { conversationId }, select: { elements: true, version: true } });
  return { conversationId, elements: (row?.elements as BoardElement[] | undefined) ?? [], version: row?.version ?? 0, canDraw };
}

/** Saves what one screen changed on the board, merged with what the others drew. Whoever may write in the conversation. */
export async function saveWhiteboard(ctx: OrgAccessContext, conversationId: string, input: unknown): Promise<{ version: number }> {
  await assertFeatureOn(ctx.orgId, "whiteboard");
  const { facts, canDraw } = await audience(ctx, conversationId);
  if (!canDraw) throw new ForbiddenError("whiteboard.e.cannot_draw");
  const incoming = cleanElements(input);
  // two saves at once: the second one merges again on top of the first (the version is the guard), never over it
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.whiteboard.findUnique({ where: { conversationId }, select: { elements: true, version: true } });
    const merged = mergeElements((row?.elements as BoardElement[] | undefined) ?? [], incoming);
    if (merged.length > MAX_ELEMENTS) throw new ValidationError([{ path: "elements", message: "whiteboard.e.too_big" }]);
    // the count is not the size: a board of few but enormous elements is refused too
    if (Buffer.byteLength(JSON.stringify(merged), "utf8") > MAX_BOARD_BYTES) {
      throw new ValidationError([{ path: "elements", message: "whiteboard.e.too_big" }]);
    }
    const elements = merged as unknown as Prisma.InputJsonValue;
    try {
      const version = await db.$transaction(async (tx) => {
        let next: number;
        if (!row) {
          await tx.whiteboard.create({ data: { orgId: ctx.orgId, conversationId, elements, version: 1, updatedById: ctx.userId } });
          next = 1;
        } else {
          const done = await tx.whiteboard.updateMany({
            where: { conversationId, version: row.version },
            data: { elements, version: row.version + 1, updatedById: ctx.userId },
          });
          if (done.count === 0) return null; // somebody saved in between: merge again
          next = row.version + 1;
        }
        await emitRealtime(tx, ctx.orgId, "whiteboard.changed", { conversationId, userId: ctx.userId, ...(facts.spaceId ? { spaceId: facts.spaceId } : {}) });
        return next;
      });
      if (version !== null) return { version };
    } catch (err) {
      // the first drawing of two people at once: one creates the board, the other merges on top of it
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  throw new ForbiddenError("whiteboard.e.busy");
}
