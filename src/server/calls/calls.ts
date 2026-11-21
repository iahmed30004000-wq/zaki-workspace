import type { OrgAccessContext } from "@/server/auth";
import { assertMemberCan, memberCan } from "@/server/policy/actor";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { isOfSpace } from "@/server/chat/space-people";
import { isSelfDmKey } from "@/server/chat/dm";
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
import { assistantState } from "./assistant-agent";
import { ct } from "@/lib/chat/text";

/**
 * CALLS — voice and video on the company's own calls server (the owner's decision, 2026-10-25): the call of a
 * conversation (a DM, a topic: «مكالمة» in its header), and a meeting of a space opened by its link. The rules
 * are src/server/policy/call.ts; the calls server is src/server/calls/livekit.ts. Nothing about the sound or the
 * picture is stored: a call row says who started it and when it ended, a seat says who was rung in or taken out.
 */

/** A call with nobody in its room for this long has ended when somebody looks at it (the first person may still be connecting). */
export const EMPTY_GRACE_MS = 20_000;
/**
 * Starting a call where one is listed but its room is empty: older than this, the old call is abandoned (nobody left to hang up
 * for it) and ending it lets the new call ring again; younger, the first person may still be connecting and the call is handed back.
 */
export const STALE_EMPTY_MS = 8_000;
/**
 * A PRIVATE call nobody answered ends by itself this long after it started (the other side rings 30 s; a few seconds more for an
 * answer that is on its way), as a missed call.
 */
export const NO_ANSWER_MS = 35_000;
/** Ringing a whole topic stops at this many people (a company-wide topic rings no crowd). */
export const RING_CAP = 200;
/** The rings of a call are counted for its starter only while the call is this young (the ringback lasts 30 s). */
const RING_COUNT_WINDOW_MS = 120_000;

export interface CallDto {
  id: string;
  title: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  spaceId: string | null;
  video: boolean;
  /** what kind of call: a private chat's (`DM`), a group's, a topic's, or a meeting by link (no conversation) */
  kind: "DM" | "GROUP" | "TOPIC" | "MEETING";
  /**
   * How many people were really rung when the call started — told to its STARTER only, while the call is young (0 for
   * everybody else, and for a call nobody was rung for). The caller's soft ringback plays only for a private call with
   * somebody rung: never a topic call, a meeting, or a call the person merely joined.
   */
  rangCount: number;
  /** the viewer started this call (they enter it with the microphone on; a topic's other joiners enter muted) */
  startedByMe: boolean;
  /** the viewer really connected to this call (on any device): a ringing card on another device closes */
  answered: boolean;
  /** how an ended PRIVATE call ended: the other person declined it, nobody answered, or it was answered and talked; null for everything else */
  endedHow: "declined" | "missed" | "answered" | null;
  startedAt: string;
  endedAt: string | null;
  startedBy: { id: string; name: string; avatarUrl: string | null };
  /** the page of the call: share it, it opens the call for whoever may join */
  path: string;
  /** who is in the room now (from the calls server; [] when it cannot be asked) */
  people: { userId: string; name: string; canRemove: boolean; canMute: boolean; avatarUrl: string | null }[];
  /** `end`: the viewer is a host and may end the call for everybody («إنهاء للكل»); everybody may leave */
  can: { invite: boolean; end: boolean };
  /** «المساعد بالاجتماعات»: the OWNER may call his assistant in (`available`), and it is in the room now (`present`) */
  assistant: { available: boolean; present: boolean };
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

interface CallRow {
  id: string;
  orgId: string;
  spaceId: string | null;
  conversationId: string | null;
  startedById: string;
}

/**
 * Ends a call: its end time, and in a conversation the «خلصت المكالمة» (or «مكالمة فايتة») line and a `call.changed` so every
 * screen of it moves (the bar goes away, a caller's page hears «رفض المكالمة»). `closeRoom`: the calls server closes the room too
 * (somebody is still in it). `quiet`: no missed-call push (the person who missed it declined it themselves). Only the first one to
 * end it writes the line (two viewers at once write one).
 */
async function finishCall(call: CallRow, opts: { authorId: string; now?: Date; closeRoom?: boolean; quiet?: boolean }): Promise<boolean> {
  let missedBy: string | null = null;
  let first = false;
  await db.$transaction(async (tx) => {
    const ended = await tx.call.updateMany({ where: { id: call.id, endedAt: null }, data: { endedAt: opts.now ?? new Date() } });
    if (ended.count === 0) return;
    first = true;
    if (call.conversationId) {
      missedBy = await writeEndLine(tx, call, opts.authorId);
      await emitRealtime(tx, call.orgId, "call.changed", { conversationId: call.conversationId, callId: call.id });
    }
  });
  if (first && opts.closeRoom) await closeRoom(call.id);
  if (first && !opts.quiet) await notifyMissed(call.startedById, missedBy, call.conversationId);
  return true;
}

/**
 * Ends a call that is over, asked lazily whenever somebody looks at it or leaves (there is no job): a PRIVATE call nobody answered
 * in `NO_ANSWER_MS` ends as a missed call, whoever is in its room; any call with nobody in its room ends once it is `graceMs` old
 * (the first person may still be connecting) — at once when the last person is leaving (`leaver`, whom the calls server may still
 * list for a moment). A calls server that cannot be asked ends nothing by emptiness.
 */
export async function settleCall(callId: string, now: Date = new Date(), opts: { graceMs?: number; leaver?: string } = {}): Promise<boolean> {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, spaceId: true, conversationId: true, startedById: true, startedAt: true, endedAt: true, conversation: { select: { kind: true } } },
  });
  if (!call || call.endedAt) return !!call?.endedAt;
  const age = now.getTime() - call.startedAt.getTime();
  if (call.conversation?.kind === "DM" && age >= NO_ANSWER_MS) {
    const answered = await db.callPerson.count({ where: { callId: call.id, userId: { not: call.startedById }, joinedAt: { not: null } } });
    if (answered === 0) return finishCall(call, { authorId: call.startedById, now, closeRoom: true });
  }
  if (age < (opts.leaver ? 0 : (opts.graceMs ?? EMPTY_GRACE_MS))) return false;
  const people = await peopleInRoom(call.id);
  if (people === null || people.some((p) => p.identity !== opts.leaver)) return false;
  return finishCall(call, { authorId: call.startedById, now });
}

/** The call going on in this conversation (settled first), or null. Its readers only. */
export async function activeCallOf(ctx: OrgAccessContext, conversationId: string): Promise<ActiveCall | null> {
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
  // who is in the room now, for the join bar's faces (the calls server cannot be asked: no faces, the call is still there)
  const inRoom = (await peopleInRoom(call.id)) ?? [];
  const faces = inRoom.length
    ? await db.user.findMany({ where: { id: { in: inRoom.slice(0, JOIN_BAR_LOOK).map((p) => p.identity) } }, select: { id: true, name: true, avatarUrl: true } })
    : [];
  const byId = new Map(faces.map((u) => [u.id, u] as const));
  const people = inRoom
    .map((p) => byId.get(p.identity))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .slice(0, JOIN_BAR_FACES)
    .map((u) => ({ userId: u.id, name: u.name, avatarUrl: u.avatarUrl }));
  return { id: call.id, video: call.video, startedAt: call.startedAt.toISOString(), count: inRoom.length, people };
}

/** The call going on in a conversation, as the join bar under its header shows it. */
export interface ActiveCall {
  id: string;
  video: boolean;
  startedAt: string;
  /** how many are in the room now */
  count: number;
  /** up to three of them, for the bar's faces */
  people: { userId: string; name: string; avatarUrl: string | null }[];
}
/** The join bar draws this many faces, and looks this far into the room to find them (an assistant is in the room without being a person). */
const JOIN_BAR_FACES = 3;
const JOIN_BAR_LOOK = 8;

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
    return keepCallable(conv.orgId, await dropMuted(conversationId, rows.map((r) => r.userId)));
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
  // a private chat rings its person whatever they muted (somebody called them on purpose); a topic or a group does not ring who muted it
  return keepCallable(conv.orgId, conv.kind === "DM" ? out : await dropMuted(conversationId, out));
}

/** Takes out who muted this conversation for themselves (`ConversationMember.mutedUntil` in the future): a mute is never rung. */
async function dropMuted(conversationId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return userIds;
  const muted = await db.conversationMember.findMany({ where: { conversationId, userId: { in: userIds }, mutedUntil: { gt: new Date() } }, select: { userId: true } });
  if (muted.length === 0) return userIds;
  const skip = new Set(muted.map((m) => m.userId));
  return userIds.filter((id) => !skip.has(id));
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
  // a listed call with nobody in its room (its people left without hanging up) is over: ending it lets this call ring
  const listed = await db.call.findFirst({ where: { conversationId, endedAt: null }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (listed) await settleCall(listed.id, new Date(), { graceMs: STALE_EMPTY_MS });
  const going = await activeCallOf(ctx, conversationId);
  if (going) return { id: going.id, created: false };
  // «الرسائل المحفوظة» (C3a.3): a private chat whose key names one person twice has nobody to call
  const selfDm = facts.kind === "DM" && isSelfDmKey((await db.conversation.findUnique({ where: { id: conversationId }, select: { dmKey: true } }))?.dmKey);
  if (!canStartCall(facts, org, { selfDm })) throw new ForbiddenError("calls.e.cannot_start");
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

/** How an ended private call ended, read from the other person's seat: they took themselves out (declined), never got in (nobody answered), or were in. */
async function howPrivateCallEnded(callId: string, starterId: string): Promise<"declined" | "missed" | "answered"> {
  const seats = await db.callPerson.findMany({ where: { callId, userId: { not: starterId } }, select: { userId: true, joinedAt: true, removedAt: true, removedById: true } });
  if (seats.some((s) => s.joinedAt)) return "answered";
  if (seats.some((s) => s.removedAt && s.removedById === s.userId)) return "declined";
  return "missed";
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
  const kind = call.conversation?.kind === "DM" || call.conversation?.kind === "GROUP" || call.conversation?.kind === "TOPIC" ? call.conversation.kind : "MEETING";
  // the rings of a young call, counted for its starter only (see `CallDto.rangCount`)
  const youngMs = Date.now() - call.startedAt.getTime();
  const rangCount =
    !call.endedAt && call.startedBy.id === ctx.userId && youngMs < RING_COUNT_WINDOW_MS
      ? await db.realtimeEvent.count({ where: { orgId: ctx.orgId, kind: "call.ring", ids: { path: ["callId"], equals: callId } } })
      : 0;
  const mySeat = await db.callPerson.findUnique({ where: { callId_userId: { callId, userId: ctx.userId } }, select: { joinedAt: true } });
  const endedHow = call.endedAt && kind === "DM" ? await howPrivateCallEnded(callId, call.startedBy.id) : null;
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
    kind,
    rangCount,
    startedByMe: call.startedBy.id === ctx.userId,
    answered: !!mySeat?.joinedAt,
    endedHow,
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
    assistant: facts.endedAt ? { available: false, present: false } : await assistantState(ctx, inRoom),
  };
}

/**
 * The person really connected to the call: the first time, their seat gets its `joinedAt` (a private call nobody joined is a missed call) and
 * the call's screens hear `call.changed` (the faces in the join bar, a ringing card on the person's other device closing).
 */
async function stampJoined(call: { orgId: string; conversationId: string | null }, callId: string, userId: string): Promise<void> {
  const seat = await db.callPerson.findUnique({ where: { callId_userId: { callId, userId } }, select: { joinedAt: true } });
  if (seat?.joinedAt) return;
  const now = new Date();
  if (seat) await db.callPerson.updateMany({ where: { callId, userId, joinedAt: null }, data: { joinedAt: now } });
  else await db.callPerson.create({ data: { callId, userId, joinedAt: now } }).catch(() => undefined); // two connects at once: the other one made the seat
  if (call.conversationId) await emitRealtime(db, call.orgId, "call.changed", { conversationId: call.conversationId, callId, userId });
}

/**
 * The short pass into a call's room, for somebody who may join it. `prefetch`: the phone is only RINGING and warms the connection with
 * the pass — that is not answering, so the seat is not stamped (the browser says `joined` when it really connects). A pass without it
 * (the phone app's) counts as joining, as before.
 */
export async function callPass(ctx: OrgAccessContext, callId: string, opts: { prefetch?: boolean } = {}): Promise<{ url: string; token: string; room: string; noiseFilter: boolean }> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (facts.endedAt) throw new ForbiddenError("calls.e.ended");
  if (!canJoinCall(facts, org)) throw new NotFoundError("calls.e.not_found");
  const server = requireCallsServer();
  const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
  if (!opts.prefetch) await stampJoined(facts, callId, ctx.userId);
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

async function privateCallRow(callId: string): Promise<(CallRow & { isDm: boolean }) | null> {
  const row = await db.call.findUnique({
    where: { id: callId },
    select: { id: true, orgId: true, spaceId: true, conversationId: true, startedById: true, conversation: { select: { kind: true } } },
  });
  return row ? { id: row.id, orgId: row.orgId, spaceId: row.spaceId, conversationId: row.conversationId, startedById: row.startedById, isDm: row.conversation?.kind === "DM" } : null;
}

/**
 * The person left the call. A PRIVATE call ends for both when either leaves (the room is closed, the line in the chat says it was
 * missed when nobody had answered); any other call ends at once when nobody else is in its room — not a minute later, and not only when
 * somebody happens to look at it.
 */
export async function leaveCall(ctx: OrgAccessContext, callId: string): Promise<void> {
  const { facts } = await ownCall(ctx, callId);
  if (facts.endedAt) return;
  const call = await privateCallRow(callId);
  if (call?.isDm) {
    await finishCall(call, { authorId: ctx.userId, closeRoom: true });
    return;
  }
  await settleCall(callId, new Date(), { leaver: ctx.userId });
}

/** The person really connected to the call's room (the browser says so after it connects; a pass fetched while ringing is not that). */
export async function markJoined(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (facts.endedAt) return;
  if (!canJoinCall(facts, org)) throw new NotFoundError("calls.e.not_found");
  await stampJoined(facts, callId, ctx.userId);
}

/**
 * «رفض»: the person rung into a PRIVATE call says no. The call ends for both — its line in the chat says it was missed, the
 * caller's page hears `call.changed` and says «رفض المكالمة», the room is closed. Nobody is told they missed it by the person who
 * declined it. In a topic or a group a «رفض» is only that person's: the call goes on for the others, and nothing is recorded.
 */
export async function declineCall(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertMemberCan(ctx, "calls.view", "section.view_denied", { spaceGuestsPass: true });
  const { facts, org } = await ownCall(ctx, callId);
  if (facts.endedAt) return;
  if (!canJoinCall(facts, org)) throw new NotFoundError("calls.e.not_found");
  if (facts.startedById === ctx.userId) return; // the caller cannot decline their own call: they hang up
  const call = await privateCallRow(callId);
  if (!call?.isDm) return;
  const now = new Date();
  await db.callPerson.upsert({
    where: { callId_userId: { callId, userId: ctx.userId } },
    create: { callId, userId: ctx.userId, removedAt: now, removedById: ctx.userId },
    update: { removedAt: now, removedById: ctx.userId },
  });
  await finishCall(call, { authorId: ctx.userId, now, closeRoom: true, quiet: true });
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
