import type { OrgAccessContext } from "@/server/auth";
import { assertMemberCan, memberCan } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { isOfSpace } from "@/server/chat/space-people";
import { writeSystemMessage } from "@/server/chat/system";
import { emitRealtime } from "@/server/realtime/emit";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import {
  canEndCall,
  canInviteToCall,
  canJoinCall,
  canMuteInCall,
  canRemoveFromCall,
  canStartCall,
  canStartMeeting,
  isCompanyStaff,
  loadCallFacts,
} from "@/server/policy/call";
import { closeRoom, dropFromRoom, muteInRoom, passFor, peopleInRoom, requireCallsServer, roomOf } from "./livekit";
import { pushTo } from "./push";
import { ct } from "@/lib/chat/text";

/**
 * CALLS — voice and video on the company's own calls server (the owner's decision, 2026-10-25): the call of a
 * conversation (a DM, a topic: «مكالمة» in its header), and a meeting of a space opened by its link. The rules
 * are src/server/policy/call.ts; the calls server is src/server/calls/livekit.ts. Nothing about the sound or the
 * picture is stored: a call row says who started it and when it ended, a seat says who was rung in or taken out.
 */

/** A call with nobody in its room for this long has ended (the first person may still be connecting). */
export const EMPTY_GRACE_MS = 60_000;
/** Ringing a whole topic stops at this many people (a company-wide topic rings no crowd). */
export const RING_CAP = 200;

export interface CallDto {
  id: string;
  title: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  spaceId: string | null;
  video: boolean;
  startedAt: string;
  endedAt: string | null;
  startedBy: { id: string; name: string; avatarUrl: string | null };
  /** the page of the call: share it, it opens the call for whoever may join */
  path: string;
  /** who is in the room now (from the calls server; [] when it cannot be asked) */
  people: { userId: string; name: string; canRemove: boolean; canMute: boolean; avatarUrl: string | null }[];
  /** `end`: the viewer is a host and may end the call for everybody («إنهاء للكل»); everybody may leave */
  can: { invite: boolean; end: boolean };
}

async function ownCall(ctx: OrgAccessContext, callId: string) {
  const loaded = await loadCallFacts(ctx.userId, callId);
  // another company's call does not exist for this viewer
  if (!loaded || loaded.facts.orgId !== ctx.orgId) throw new NotFoundError("calls.e.not_found");
  return loaded;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * The line an ending call leaves in its conversation, and who missed it: in a DM, when the other person never got into
 * the call (never answered), it is «مكالمة فايتة» and they get a missed-call notice; otherwise «خلصت المكالمة».
 */
async function writeEndLine(
  tx: Tx,
  call: { id: string; orgId: string; spaceId: string | null; conversationId: string | null; startedById: string },
  authorId: string,
): Promise<string | null> {
  if (!call.conversationId) return null;
  const conv = await tx.conversation.findUnique({ where: { id: call.conversationId }, select: { kind: true, members: { select: { userId: true } } } });
  let missedBy: string | null = null;
  if (conv?.kind === "DM") {
    const other = conv.members.map((m) => m.userId).find((id) => id !== call.startedById);
    if (other) {
      const seat = await tx.callPerson.findUnique({ where: { callId_userId: { callId: call.id, userId: other } }, select: { joinedAt: true } });
      if (!seat?.joinedAt) missedBy = other;
    }
  }
  await writeSystemMessage(tx, { orgId: call.orgId, conversationId: call.conversationId, authorId, k: missedBy ? "call_missed" : "call_ended", spaceId: call.spaceId });
  return missedBy;
}

/** «مكالمة فايتة من فلان» on the phone of whoever missed it (opens the DM). */
async function notifyMissed(callerId: string, missedBy: string | null, conversationId: string | null): Promise<void> {
  if (!missedBy || !conversationId) return;
  const caller = await db.user.findUnique({ where: { id: callerId }, select: { name: true } });
  await pushTo([missedBy], {
    kind: "missed",
    title: ct("calls.push.missed_title", { name: caller?.name ?? "" }),
    body: ct("calls.push.missed_body"),
    url: `/chat/${conversationId}`,
    tag: `missed-${conversationId}`,
  }).catch(() => undefined);
}

/** «فلان عم يرنّ عليك» on the phones of the people rung, for whom the site is closed (the open app rings by itself). */
async function notifyRing(callId: string, callerId: string, userIds: string[], where: string | null, video: boolean): Promise<void> {
  if (userIds.length === 0) return;
  const caller = await db.user.findUnique({ where: { id: callerId }, select: { name: true } });
  await pushTo(userIds, {
    kind: "ring",
    title: ct("calls.push.ring_title", { name: caller?.name ?? "" }),
    body: [video ? ct("calls.video") : ct("calls.audio"), where ? ct("calls.ring.in", { title: where }) : ""].filter(Boolean).join(" "),
    url: `/calls/${callId}`,
    tag: `call-${callId}`,
  }).catch(() => undefined);
}

/**
 * Ends a call nobody is in any more (asked lazily, whenever somebody looks at it or leaves): its end time, and in
 * a conversation the «انتهت المكالمة» line and a `call.changed` so its bar goes away. A calls server that cannot
 * be asked ends nothing.
 */
export async function settleCall(callId: string, now: Date = new Date()): Promise<boolean> {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, spaceId: true, conversationId: true, startedById: true, startedAt: true, endedAt: true },
  });
  if (!call || call.endedAt) return !!call?.endedAt;
  if (now.getTime() - call.startedAt.getTime() < EMPTY_GRACE_MS) return false;
  const people = await peopleInRoom(call.id);
  if (people === null || people.length > 0) return false;
  let missedBy: string | null = null;
  const done = await db.$transaction(async (tx) => {
    // only the first one to see it empty ends it (two viewers at once write one line)
    const ended = await tx.call.updateMany({ where: { id: call.id, endedAt: null }, data: { endedAt: now } });
    if (ended.count === 0) return true;
    if (call.conversationId) {
      missedBy = await writeEndLine(tx, call, call.startedById);
      await emitRealtime(tx, call.orgId, "call.changed", { conversationId: call.conversationId, callId: call.id });
    }
    return true;
  });
  await notifyMissed(call.startedById, missedBy, call.conversationId);
  return done;
}

/** The call going on in this conversation (settled first), or null. Its readers only. */
export async function activeCallOf(ctx: OrgAccessContext, conversationId: string): Promise<{ id: string; video: boolean; startedAt: string } | null> {
  // «المكالمات» off (or «وضع التوفير»): nobody is on a call here, and the calls server is never asked
  if (!(await isFeatureOn(ctx.orgId, "calls"))) return null;
  // the calls row of the person's grid (an external partner by the space's rules)
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const open = await db.call.findFirst({ where: { conversationId, endedAt: null }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (!open || (await settleCall(open.id))) return null;
  const call = await db.call.findUniqueOrThrow({ where: { id: open.id }, select: { id: true, video: true, startedAt: true } });
  return { id: call.id, video: call.video, startedAt: call.startedAt.toISOString() };
}

/**
 * The people a call of this conversation rings: its audience (a DM's other person; a topic's space people, or its
 * own rows when restricted, or its «مقطع»), never the caller, and the OWNER only where he is IN (a row): his
 * silent reading never rings his phone.
 */
export async function ringAudience(conversationId: string, callerId: string): Promise<string[]> {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { orgId: true, kind: true, spaceId: true, restricted: true, teamId: true, members: { select: { userId: true } } },
  });
  if (conv.kind === "TOPIC" && !conv.restricted && !conv.teamId && conv.spaceId) {
    // the whole space reads it: its ACTIVE people with a row, in one query (a big space rings without a query each)
    const rows = await db.organizationMember.findMany({
      where: { organizationId: conv.orgId, status: "ACTIVE", userId: { not: callerId }, user: { workspaceLinks: { some: { workspaceId: conv.spaceId } } } },
      select: { userId: true },
      orderBy: { userId: "asc" },
      take: RING_CAP,
    });
    return keepCallable(conv.orgId, rows.map((r) => r.userId));
  }
  let candidates: string[];
  if (conv.kind === "TOPIC" && !conv.restricted && conv.spaceId) {
    const rows = await db.workspaceMember.findMany({ where: { workspaceId: conv.spaceId }, select: { userId: true }, take: RING_CAP * 2 });
    candidates = rows.map((r) => r.userId);
  } else {
    candidates = conv.members.map((m) => m.userId);
  }
  const out: string[] = [];
  for (const userId of candidates) {
    if (userId === callerId || out.length >= RING_CAP) continue;
    const facts = await loadConversationFacts(userId, conversationId);
    if (facts && canRead(facts, await loadOrgFacts(userId, facts.orgId))) out.push(userId);
  }
  return keepCallable(conv.orgId, out);
}

/** Only who may join a call is rung: the calls «يشوف» box of the section grid (an external partner by the space's rules). */
async function keepCallable(orgId: string, userIds: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const userId of userIds) if ((await memberCan({ orgId, userId }, "calls.view", { spaceGuestsPass: true })) === true) kept.push(userId);
  return kept;
}

/**
 * Starts the call of a conversation — or, when one is going on, hands back that one (one call per conversation
 * at a time). `ring`: ring its people (a DM always rings).
 */
export async function startConversationCall(
  ctx: OrgAccessContext,
  conversationId: string,
  opts: { video: boolean; ring: boolean },
): Promise<{ id: string; created: boolean }> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const going = await activeCallOf(ctx, conversationId);
  if (going) return { id: going.id, created: false };
  if (!canStartCall(facts, org)) throw new ForbiddenError("calls.e.cannot_start");
  requireCallsServer();
  const ring = facts.kind === "DM" ? true : opts.ring;
  const audience = ring ? await ringAudience(conversationId, ctx.userId) : [];
  const call = await db.$transaction(async (tx) => {
    const row = await tx.call.create({
      data: { orgId: ctx.orgId, spaceId: facts.spaceId, conversationId, video: opts.video, startedById: ctx.userId },
      select: { id: true },
    });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId, authorId: ctx.userId, k: "call_started", p: { video: opts.video ? 1 : 0 }, spaceId: facts.spaceId });
    await emitRealtime(tx, ctx.orgId, "call.changed", { conversationId, callId: row.id });
    for (const userId of audience) {
      await emitRealtime(tx, ctx.orgId, "call.ring", { callId: row.id, userId: ctx.userId, targetUserId: userId, ...(facts.spaceId ? { spaceId: facts.spaceId } : {}) });
    }
    return row;
  });
  const where = facts.kind === "TOPIC" ? ((await db.conversation.findUnique({ where: { id: conversationId }, select: { title: true } }))?.title ?? null) : null;
  void notifyRing(call.id, ctx.userId, audience, where, opts.video);
  return { id: call.id, created: true };
}

/** Opens a meeting of the space the person is in: a call with a link, for the space's people. */
export async function startMeeting(ctx: OrgAccessContext, spaceId: string, opts: { title: string | null; video: boolean }): Promise<{ id: string }> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const space = await db.workspace.findFirst({ where: { id: spaceId, organizationId: ctx.orgId }, select: { id: true } });
  if (!space) throw new NotFoundError("calls.e.not_found");
  if (!canStartMeeting(org, await isOfSpace(ctx.orgId, spaceId, ctx.userId))) throw new ForbiddenError("calls.e.cannot_start");
  requireCallsServer();
  return db.call.create({
    data: { orgId: ctx.orgId, spaceId, title: opts.title, video: opts.video, startedById: ctx.userId },
    select: { id: true },
  });
}

/** One call as its page shows it. Whoever may join it. */
export async function callDetail(ctx: OrgAccessContext, callId: string): Promise<CallDto> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  await settleCall(callId);
  const { facts, org } = await ownCall(ctx, callId);
  // an ended call still answers the people who could have been in it (its page says «خلصت»), nobody else:
  // a DM's call never tells the rest of the space that two people talked
  if (!canJoinCall({ ...facts, endedAt: null }, org)) throw new NotFoundError("calls.e.not_found");
  const call = await db.call.findUniqueOrThrow({
    where: { id: callId },
    select: {
      id: true,
      title: true,
      conversationId: true,
      spaceId: true,
      video: true,
      startedAt: true,
      endedAt: true,
      startedBy: { select: { id: true, name: true, avatarUrl: true } },
      conversation: { select: { title: true, kind: true } },
    },
  });
  const inRoom = facts.endedAt ? [] : ((await peopleInRoom(callId)) ?? []);
  const ranks = inRoom.length
    ? await db.organizationMember.findMany({ where: { organizationId: ctx.orgId, userId: { in: inRoom.map((p) => p.identity) } }, select: { userId: true, role: true, user: { select: { name: true, avatarUrl: true } } } }) // all-statuses: names of the people the calls server says are in the room
    : [];
  const byId = new Map(ranks.map((r) => [r.userId, r] as const));
  return {
    id: call.id,
    title: call.title,
    conversationId: call.conversationId,
    conversationTitle: call.conversation?.kind === "TOPIC" ? call.conversation.title : null,
    spaceId: call.spaceId,
    video: call.video,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? null,
    startedBy: { id: call.startedBy.id, name: call.startedBy.name, avatarUrl: call.startedBy.avatarUrl },
    path: `/calls/${call.id}`,
    people: inRoom
      .filter((p) => byId.has(p.identity))
      .map((p) => {
        const row = byId.get(p.identity)!;
        const target = { userId: p.identity, role: row.role };
        return { userId: p.identity, name: row.user.name, avatarUrl: row.user.avatarUrl, canRemove: canRemoveFromCall(facts, org, ctx.userId, target), canMute: canMuteInCall(facts, org, ctx.userId, target) };
      }),
    can: { invite: canInviteToCall(facts, org), end: !facts.endedAt && canEndCall(facts, org, ctx.userId) },
  };
}

/** The short pass into a call's room, for somebody who may join it. */
export async function callPass(ctx: OrgAccessContext, callId: string): Promise<{ url: string; token: string; room: string; noiseFilter: boolean }> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (facts.endedAt) throw new ForbiddenError("calls.e.ended");
  if (!canJoinCall(facts, org)) throw new NotFoundError("calls.e.not_found");
  const server = requireCallsServer();
  const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
  await db.callPerson.upsert({
    where: { callId_userId: { callId, userId: ctx.userId } },
    create: { callId, userId: ctx.userId, joinedAt: new Date() },
    update: {},
  });
  await db.callPerson.updateMany({ where: { callId, userId: ctx.userId, joinedAt: null }, data: { joinedAt: new Date() } });
  return {
    url: server.url,
    room: roomOf(callId),
    token: await passFor(server, { callId, userId: ctx.userId, name: me.name }),
    // the owner's switch «تنقية صوت المكالمات»: the browser cleans the microphone of noise before sending it
    noiseFilter: await isFeatureOn(ctx.orgId, "callNoiseFilter"),
  };
}

/** «ضيف حدا»: rings one of the space's people into the call (they get a seat: the call, not the conversation). */
export async function inviteToCall(ctx: OrgAccessContext, callId: string, userId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (!canInviteToCall(facts, org)) throw new ForbiddenError("calls.e.cannot_invite");
  const ofSpace = facts.spaceId ? await isOfSpace(ctx.orgId, facts.spaceId, userId) : await isCompanyStaff(ctx.orgId, userId);
  if (!ofSpace) throw new ForbiddenError("calls.e.not_in_space");
  await db.$transaction(async (tx) => {
    // ringing back somebody who was taken out gives them their seat again: the caller decided
    await tx.callPerson.upsert({
      where: { callId_userId: { callId, userId } },
      create: { callId, userId, invitedById: ctx.userId },
      update: { invitedById: ctx.userId, removedAt: null, removedById: null },
    });
    await emitRealtime(tx, ctx.orgId, "call.ring", { callId, userId: ctx.userId, targetUserId: userId, ...(facts.spaceId ? { spaceId: facts.spaceId } : {}) });
  });
  const row = await db.call.findUnique({ where: { id: callId }, select: { title: true, video: true, conversation: { select: { title: true, kind: true } } } });
  const where = row?.title ?? (row?.conversation?.kind === "TOPIC" ? row.conversation.title : null);
  void notifyRing(callId, ctx.userId, [userId], where, !!row?.video);
}

/** Takes somebody out of the call: out of the room now, and no new pass for this call. */
export async function removeFromCall(ctx: OrgAccessContext, callId: string, userId: string): Promise<void> {
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  const target = await db.organizationMember.findUnique({ // all-statuses: a suspended person still in the room is taken out all the same; the rank only guards the owner
    where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
    select: { role: true },
  });
  if (!target || !canRemoveFromCall(facts, org, ctx.userId, { userId, role: target.role })) throw new ForbiddenError("calls.e.cannot_remove");
  const now = new Date();
  await db.callPerson.upsert({
    where: { callId_userId: { callId, userId } },
    create: { callId, userId, removedAt: now, removedById: ctx.userId },
    update: { removedAt: now, removedById: ctx.userId },
  });
  await dropFromRoom(callId, userId);
}

/** The person left the call's page: end it when it is empty now. */
export async function leaveCall(ctx: OrgAccessContext, callId: string): Promise<void> {
  await ownCall(ctx, callId);
  await settleCall(callId);
}

/**
 * «إنهاء للكل»: a host ends the call for everybody — its end time, «خلصت المكالمة» in its conversation, `call.changed`
 * so every screen closes it, and the calls server closes the room (every browser hears the call ended). Done on the
 * server; the others can only leave, and the call goes on without them.
 */
export async function endCall(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (facts.endedAt) return;
  if (!canEndCall(facts, org, ctx.userId)) throw new ForbiddenError("calls.e.cannot_end");
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, select: { id: true, orgId: true, spaceId: true, conversationId: true, startedById: true } });
  let missedBy: string | null = null;
  await db.$transaction(async (tx) => {
    const ended = await tx.call.updateMany({ where: { id: callId, endedAt: null }, data: { endedAt: new Date() } });
    if (ended.count === 0) return;
    missedBy = await writeEndLine(tx, call, ctx.userId);
    await emitRealtime(tx, call.orgId, "call.changed", { ...(call.conversationId ? { conversationId: call.conversationId } : {}), callId });
  });
  await closeRoom(callId);
  await notifyMissed(call.startedById, missedBy, call.conversationId);
}

/** «اكتم»: a host mutes one person's microphone (they unmute themselves when they want to speak). */
export async function muteInCall(ctx: OrgAccessContext, callId: string, userId: string): Promise<void> {
  await assertMemberCan(ctx, "calls.edit", "section.edit_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  const target = await db.organizationMember.findUnique({ // all-statuses: the rank only guards the owner, like taking out
    where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
    select: { role: true },
  });
  if (!target || !canMuteInCall(facts, org, ctx.userId, { userId, role: target.role })) throw new ForbiddenError("calls.e.cannot_mute");
  await muteInRoom(callId, userId);
}
