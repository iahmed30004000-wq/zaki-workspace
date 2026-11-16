import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { parse } from "@/server/validation";
import { canReadConversation, isActiveOf, isOwnerOf, loadOrgFacts } from "@/server/policy/conversation";
import { dmPlaceWhere } from "@/server/chat/dm";
import { ORDER_MAX, cleanOrder, orderSchema, scopeSchema } from "@/lib/chat/order";

/**
 * The person's OWN order of the chat list. It lives in `UserChatOrder` (one row per person, company and list)
 * and is only ever read for its owner: it never touches the space's order, the moderators' pin, anybody
 * else's list, or any read state (the OWNER reading silently still writes nothing but his own row).
 *
 * What may be saved is decided here, from the policy, every time: only ids of conversations the person may
 * read RIGHT NOW and that belong to the list being ordered. What was saved is filtered again when the list is
 * built (`applySavedOrder`), so an id that vanished or lost access is just ignored.
 */

/** The saved orders of the person in this company, for the given lists (a list without one is absent). */
export async function loadOrders(ctx: OrgAccessContext, scopes: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (scopes.length === 0) return out;
  const rows = await db.userChatOrder.findMany({
    where: { userId: ctx.userId, orgId: ctx.orgId, scope: { in: [...scopes] } },
    select: { scope: true, order: true },
  });
  for (const row of rows) {
    const order = cleanOrder(row.order);
    if (order.length) out.set(row.scope, order);
  }
  return out;
}

/** Every saved order of the person in this company, as `{ scope: ids }` (what the screen asks for). */
export async function listOrders(ctx: OrgAccessContext): Promise<Record<string, string[]>> {
  const rows = await db.userChatOrder.findMany({
    where: { userId: ctx.userId, orgId: ctx.orgId },
    select: { scope: true, order: true },
    orderBy: { scope: "asc" },
  });
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    const order = cleanOrder(row.order);
    if (order.length) out[row.scope] = order;
  }
  return out;
}

/** Which conversation rows belong to the list `scope`, for this person. Throws when the list is not theirs. */
async function candidatesOf(ctx: OrgAccessContext, scope: string, ids: string[]): Promise<string[]> {
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!isActiveOf(org)) throw new NotFoundError("chat.e.not_found");

  if (scope.startsWith("space:")) {
    const spaceId = scope.slice("space:".length);
    const space = await db.workspace.findFirst({ where: { id: spaceId, organizationId: ctx.orgId }, select: { id: true } });
    if (!space) throw new NotFoundError("chat.e.not_found");
    // the OWNER needs no row (he reads every space silently); everybody else must be in the space
    if (!isOwnerOf(org) /* oversight-ok: the OWNER rank is a space ADMIN of every space */) {
      const member = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: ctx.userId } }, select: { id: true } });
      if (!member) throw new NotFoundError("chat.e.not_found");
    }
    const rows = await db.conversation.findMany({ where: { id: { in: ids }, orgId: ctx.orgId, kind: "TOPIC", spaceId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // «dm» / «dm:<space>»: the person's own private chats (never a guest's, never one only read in oversight)
  if (org!.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const spaceId = scope.startsWith("dm:") ? scope.slice("dm:".length) : null;
  const rows = await db.conversation.findMany({
    where: {
      id: { in: ids },
      orgId: ctx.orgId,
      kind: { in: ["DM", "GROUP"] },
      members: { some: { userId: ctx.userId } },
      ...(await dmPlaceWhere(spaceId)),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Saves the person's order of one list and returns what was kept: their ids, once each, in their order,
 * without the ones they may not read. Nothing left to keep means no order at all (the same as a reset).
 */
export async function saveOrder(ctx: OrgAccessContext, scopeInput: string, orderInput: string[]): Promise<string[]> {
  const scope = parse(scopeSchema, scopeInput);
  const wanted = [...new Set(parse(orderSchema, orderInput))];

  const known = new Set(await candidatesOf(ctx, scope, wanted));
  // the policy has the last word, one conversation at a time (a restricted topic, a مقطع, a DM's other person)
  const kept: string[] = [];
  const CHUNK = 12;
  const inList = wanted.filter((id) => known.has(id));
  for (let i = 0; i < inList.length; i += CHUNK) {
    const part = inList.slice(i, i + CHUNK);
    const answers = await Promise.all(part.map((id) => canReadConversation(ctx.userId, id)));
    part.forEach((id, n) => { if (answers[n]) kept.push(id); });
  }
  const order = kept.slice(0, ORDER_MAX);

  if (order.length === 0) {
    await db.userChatOrder.deleteMany({ where: { userId: ctx.userId, orgId: ctx.orgId, scope } });
    return [];
  }
  await db.userChatOrder.upsert({
    where: { userId_orgId_scope: { userId: ctx.userId, orgId: ctx.orgId, scope } },
    create: { userId: ctx.userId, orgId: ctx.orgId, scope, order },
    update: { order },
  });
  return order;
}

/** «رجّع الترتيب الأصلي»: forgets the person's order of one list. Nothing saved is not an error. */
export async function resetOrder(ctx: OrgAccessContext, scopeInput: string): Promise<void> {
  const scope = parse(scopeSchema, scopeInput);
  await db.userChatOrder.deleteMany({ where: { userId: ctx.userId, orgId: ctx.orgId, scope } });
}
