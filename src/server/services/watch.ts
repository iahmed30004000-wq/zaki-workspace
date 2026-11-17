import { z } from "zod";
import { assertMemberCan } from "@/server/policy/actor";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { AR } from "@/lib/i18n/dict";
import { parseWatchLink, watchEmbedUrl, watchPageUrl, watchThumbUrl, type WatchKind } from "@/lib/watch/source";
import { assertPeopleOfSpace } from "@/server/chat/topics";
import { isOfSpace } from "@/server/chat/space-people";
import { writeSystemMessage } from "@/server/chat/system";
import { emitRealtime } from "@/server/realtime/emit";
import { pushNotificationToMany } from "@/server/notify";
import { hasOversight, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { canEndWatch, canHandOverWatch, canSeeWatch, canStartWatch } from "@/server/policy/watch";
import { canPress, type RemoteState } from "@/lib/watch/sync";
import { videoTitle } from "@/server/watch/title";

/**
 * «نتفرّج سوا» — people of a space watch one link together (the owner's ask, 2026-10-26).
 *
 * A session is a restricted topic of the space (🎬) plus its `WatchSession` row: the people it was started for are
 * the topic's members, so the chat, the call, the whiteboard and who may see any of it are the topic's own rules
 * (src/server/policy/conversation.ts). Links only: nothing is uploaded, the video plays from its own site on every
 * screen. The rules are src/server/policy/watch.ts.
 */

/** A session is for this many people at most (a whole company is no watching party). */
export const WATCH_PEOPLE_CAP = 200;
export const WATCH_EMOJI = "🎬";

export const startWatchSchema = z.object({
  url: z.string().trim().min(1, "watch.e.link").max(2000, "watch.e.link"),
  title: z.string().trim().max(120, "chat.e.too_long").optional(),
  /** who it is for: these people of the space, or (`everyone`) all of its staff */
  memberIds: z.array(z.string().min(1)).max(WATCH_PEOPLE_CAP).default([]),
  everyone: z.boolean().default(false),
});

export interface WatchSessionDto {
  id: string;
  title: string;
  kind: WatchKind;
  ref: string;
  /** the video's page at its own site */
  pageUrl: string;
  thumbUrl: string;
  host: { id: string; name: string };
  peopleCount: number;
  live: boolean;
  createdAt: string;
  endedAt: string | null;
  conversationId: string;
}

/** The remote of a session as a screen needs it: the state, the server's clock, who holds it, what this person may do. */
export interface WatchRemoteDto {
  state: RemoteState;
  /** the server's clock when it answered (a screen works out its own offset from it) */
  serverNow: number;
  hostId: string;
  everyoneControls: boolean;
  live: boolean;
  can: { press: boolean; handOver: boolean };
}

export interface WatchDetailDto extends WatchSessionDto {
  embedUrl: string;
  /** the video's start (`?t=` of the link) */
  startSec: number;
  people: { id: string; name: string }[];
  remote: WatchRemoteDto;
  can: { end: boolean };
}

const sessionSelect = {
  id: true,
  title: true,
  sourceKind: true,
  sourceRef: true,
  positionSec: true,
  playing: true,
  stateAt: true,
  version: true,
  everyoneControls: true,
  hostId: true,
  startedById: true,
  createdAt: true,
  endedAt: true,
  conversationId: true,
  host: { select: { id: true, name: true } },
  startedBy: { select: { id: true, name: true } },
} as const;

type SessionRow = {
  id: string;
  title: string;
  sourceKind: string;
  sourceRef: string;
  positionSec: number;
  playing: boolean;
  stateAt: Date;
  version: number;
  everyoneControls: boolean;
  hostId: string;
  startedById: string | null;
  createdAt: Date;
  endedAt: Date | null;
  conversationId: string;
  host: { id: string; name: string };
  startedBy: { id: string; name: string } | null;
};

function present(row: SessionRow, peopleCount: number): WatchSessionDto {
  const source = { kind: row.sourceKind as WatchKind, ref: row.sourceRef };
  return {
    id: row.id,
    title: row.title,
    kind: source.kind,
    ref: source.ref,
    pageUrl: watchPageUrl(source),
    thumbUrl: watchThumbUrl(source),
    // who started it: the remote may be in somebody else's hands since
    host: row.startedBy ?? row.host,
    peopleCount,
    live: !row.endedAt,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    conversationId: row.conversationId,
  };
}

/** The ACTIVE staff of a space (the people a session may be started for), the asker left out. */
export async function watchCandidates(orgId: string, spaceId: string, exceptUserId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.workspaceMember.findMany({
    where: {
      workspaceId: spaceId,
      userId: { not: exceptUserId },
      user: { memberships: { some: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
    },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
    take: WATCH_PEOPLE_CAP,
  });
  return rows.map((r) => r.user);
}

/** Starts a session in a space: its topic, its row, a line in the talk and a word to everybody it is for. */
export async function startWatch(ctx: OrgAccessContext, spaceId: string, input: z.infer<typeof startWatchSchema>): Promise<{ id: string; conversationId: string }> {
  await assertMemberCan(ctx, "watch.edit", "section.edit_denied");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const space = await db.workspace.findFirst({ where: { id: spaceId, organizationId: ctx.orgId }, select: { id: true } });
  if (!space) throw new NotFoundError("watch.e.not_found");
  if (!canStartWatch(org, await isOfSpace(ctx.orgId, spaceId, ctx.userId))) throw new ForbiddenError("watch.e.cannot_start");

  const source = parseWatchLink(input.url);
  if (!source) throw new ValidationError([{ path: "url", message: "watch.e.link" }]);

  // who it is for: people of this space and of the staff (an external partner is never invited)
  let people: string[];
  if (input.everyone) {
    people = (await watchCandidates(ctx.orgId, spaceId, ctx.userId)).map((p) => p.id);
  } else {
    people = [...new Set(input.memberIds)].filter((id) => id !== ctx.userId);
    await assertPeopleOfSpace(ctx.orgId, spaceId, people);
    const guests = await db.organizationMember.count({ where: { organizationId: ctx.orgId, userId: { in: people }, role: "GUEST" } }); // all-statuses: a guest of any status is refused
    if (guests > 0) throw new ForbiddenError("watch.e.no_guests");
  }

  const title = input.title || (await videoTitle(source)) || AR["watch.default_title"] || "نتفرّج سوا";

  const out = await db.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        orgId: ctx.orgId,
        spaceId,
        kind: "TOPIC",
        title,
        emoji: WATCH_EMOJI,
        restricted: true,
        members: { create: [{ userId: ctx.userId }, ...people.map((userId) => ({ userId }))] },
      },
      select: { id: true },
    });
    const session = await tx.watchSession.create({
      data: {
        orgId: ctx.orgId,
        spaceId,
        conversationId: conv.id,
        hostId: ctx.userId,
        startedById: ctx.userId,
        title,
        sourceKind: source.kind,
        sourceRef: source.ref,
        sourceUrl: input.url,
        positionSec: source.startSec,
      },
      select: { id: true },
    });
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId: conv.id, authorId: ctx.userId, k: "watch_started", spaceId });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: conv.id, spaceId });
    return { id: session.id, conversationId: conv.id };
  });

  const host = await db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  await pushNotificationToMany(people, {
    type: "watch_invite",
    title: AR["notif.type.watch_invite"] ?? "إشعار",
    body: `${host?.name ?? ""} · ${title}`,
    linkUrl: `/watch/${out.id}`,
    workspaceId: spaceId,
  });
  return out;
}

/** The sessions of a space this person may see: the ones they were started for (the OWNER: all), live ones first. */
export async function listWatch(ctx: OrgAccessContext, spaceId: string): Promise<WatchSessionDto[]> {
  await assertMemberCan(ctx, "watch.view", "section.view_denied");
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!org || org.status !== "ACTIVE" || org.role === "GUEST") return [];
  const rows = await db.watchSession.findMany({
    where: {
      orgId: ctx.orgId,
      spaceId,
      ...(hasOversight(org)
        ? {}
        : { conversation: { members: { some: { userId: ctx.userId } } }, space: { members: { some: { userId: ctx.userId } } } }),
    },
    select: { ...sessionSelect, conversation: { select: { _count: { select: { members: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const out = rows.map((r) => present(r, r.conversation._count.members));
  return [...out.filter((s) => s.live), ...out.filter((s) => !s.live)];
}

async function guardSession(ctx: OrgAccessContext, id: string) {
  const row = await db.watchSession.findFirst({ where: { id, orgId: ctx.orgId }, select: { ...sessionSelect, spaceId: true } });
  if (!row) throw new NotFoundError("watch.e.not_found");
  const [conv, org] = await Promise.all([loadConversationFacts(ctx.userId, row.conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  // a session somebody may not see does not exist for them
  if (!canSeeWatch(conv, org)) throw new NotFoundError("watch.e.not_found");
  return { row, conv, org };
}

/** One session as its page shows it. */
export async function watchDetail(ctx: OrgAccessContext, id: string): Promise<WatchDetailDto & { spaceId: string }> {
  await assertMemberCan(ctx, "watch.view", "section.view_denied");
  const { row, conv, org } = await guardSession(ctx, id);
  const members = await db.conversationMember.findMany({
    where: { conversationId: row.conversationId, user: { memberships: { some: { organizationId: ctx.orgId, status: "ACTIVE" } } } },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return {
    ...present(row, members.length),
    embedUrl: watchEmbedUrl({ kind: row.sourceKind as WatchKind, ref: row.sourceRef }, row.positionSec),
    startSec: row.positionSec,
    people: members.map((m) => m.user),
    remote: remoteOf(row, ctx.userId, conv, org),
    can: { end: !row.endedAt && canEndWatch(row, ctx.userId, conv, org) },
    spaceId: row.spaceId,
  };
}

type Guarded = Awaited<ReturnType<typeof guardSession>>;

function remoteOf(row: SessionRow, viewerId: string, conv: Guarded["conv"], org: Guarded["org"]): WatchRemoteDto {
  const ended = !!row.endedAt;
  return {
    state: { playing: row.playing && !ended, positionSec: row.positionSec, stateAt: row.stateAt.getTime(), version: row.version },
    serverNow: Date.now(),
    hostId: row.hostId,
    everyoneControls: row.everyoneControls,
    live: !ended,
    can: {
      press: canPress({ hostId: row.hostId, everyoneControls: row.everyoneControls, ended }, viewerId),
      handOver: !ended && canHandOverWatch(row, viewerId, conv, org),
    },
  };
}

/** The remote of one session, for its people (the page asks again after every `watch.changed`). */
export async function watchRemote(ctx: OrgAccessContext, id: string): Promise<WatchRemoteDto> {
  await assertMemberCan(ctx, "watch.view", "section.view_denied");
  const { row, conv, org } = await guardSession(ctx, id);
  return remoteOf(row, ctx.userId, conv, org);
}

/** The longest a video may be said to be at (a day): a wrong number never reaches the other screens. */
export const MAX_POSITION_SEC = 86_400;

export const pressSchema = z.object({
  playing: z.boolean(),
  positionSec: z.number().finite().min(0).max(MAX_POSITION_SEC),
});

/**
 * A press of the remote (play, pause, a jump): only whoever holds it. The state is written with the server's own
 * clock and a version one higher, and the session's people are told (`watch.changed`, ids only) to fetch it.
 */
export async function pressRemote(ctx: OrgAccessContext, id: string, input: z.infer<typeof pressSchema>): Promise<WatchRemoteDto> {
  await assertMemberCan(ctx, "watch.view", "section.view_denied");
  const { row, conv, org } = await guardSession(ctx, id);
  if (!canPress({ hostId: row.hostId, everyoneControls: row.everyoneControls, ended: !!row.endedAt }, ctx.userId)) {
    throw new ForbiddenError(row.endedAt ? "watch.e.ended" : "watch.e.not_remote");
  }
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.watchSession.update({
      where: { id },
      data: { playing: input.playing, positionSec: input.positionSec, stateAt: new Date(), version: { increment: 1 } },
      select: sessionSelect,
    });
    await emitRealtime(tx, ctx.orgId, "watch.changed", { conversationId: row.conversationId, spaceId: conv?.spaceId ?? undefined });
    return next;
  });
  return remoteOf(updated, ctx.userId, conv, org);
}

export const handOverSchema = z
  .object({
    /** give the remote to this person of the session */
    hostId: z.string().min(1).optional(),
    /** «الكل بيتحكّم» on or off */
    everyoneControls: z.boolean().optional(),
  })
  .refine((v) => v.hostId !== undefined || v.everyoneControls !== undefined, { message: "watch.e.nothing" });

/** Hands the remote to one of the session's people, or opens it to all of them: the host, the space's admin, the owner. */
export async function handOverRemote(ctx: OrgAccessContext, id: string, input: z.infer<typeof handOverSchema>): Promise<WatchRemoteDto> {
  await assertMemberCan(ctx, "watch.view", "section.view_denied");
  const { row, conv, org } = await guardSession(ctx, id);
  if (row.endedAt) throw new ForbiddenError("watch.e.ended");
  if (!canHandOverWatch(row, ctx.userId, conv, org)) throw new ForbiddenError("watch.e.not_remote");
  if (input.hostId && input.hostId !== row.hostId) {
    // only one of the session's own people (an active one, never an external partner) takes the remote
    const member = await db.conversationMember.count({
      where: {
        conversationId: row.conversationId,
        userId: input.hostId,
        user: { memberships: { some: { organizationId: ctx.orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
      },
    });
    if (member === 0) throw new ForbiddenError("watch.e.not_member");
  }
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.watchSession.update({
      where: { id },
      data: {
        ...(input.hostId ? { hostId: input.hostId } : {}),
        ...(input.everyoneControls !== undefined ? { everyoneControls: input.everyoneControls } : {}),
        version: { increment: 1 },
      },
      select: sessionSelect,
    });
    await emitRealtime(tx, ctx.orgId, "watch.changed", { conversationId: row.conversationId, spaceId: conv?.spaceId ?? undefined });
    return next;
  });
  return remoteOf(updated, ctx.userId, conv, org);
}

/** Ends a session (its talk stays, like any topic). Ending an ended one changes nothing. */
export async function endWatch(ctx: OrgAccessContext, id: string): Promise<void> {
  await assertMemberCan(ctx, "watch.edit", "section.edit_denied");
  const { row, conv, org } = await guardSession(ctx, id);
  if (!canEndWatch(row, ctx.userId, conv, org)) throw new ForbiddenError("watch.e.cannot_end");
  await db.$transaction(async (tx) => {
    const ended = await tx.watchSession.updateMany({ where: { id, endedAt: null }, data: { endedAt: new Date(), playing: false } });
    if (ended.count === 0) return;
    await writeSystemMessage(tx, { orgId: ctx.orgId, conversationId: row.conversationId, authorId: ctx.userId, k: "watch_ended", spaceId: conv?.spaceId });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: row.conversationId, spaceId: conv?.spaceId ?? undefined });
  });
}
