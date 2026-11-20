import { db } from "@/server/db";
import { isOfSpace } from "@/server/chat/space-people";
import {
  canModerate,
  canPost,
  canRead,
  isActiveOf,
  hasOversight,
  isOwnerOf,
  isSpaceAdmin,
  loadConversationFacts,
  loadOrgFacts,
  type ConversationFacts,
  type OrgFacts,
} from "./conversation";

/**
 * The calls policy (the owner's decisions, 2026-10-25): pure `can*` functions over a facts object, plus the loader.
 *
 *  - the call of a conversation is for the conversation's readers (`canRead`, the same rule as its messages);
 *    starting one needs the right to WRITE there (`canPost`): a muted person, a guest in announcements and the
 *    OWNER where he has not joined do not start calls — the owner may still join any call, silently allowed like
 *    his reading, and he is seen only once he is in;
 *  - a meeting (a call with no conversation, opened by its link) is for the people of its space;
 *  - «ضيف حدا» brings in one of the space's people (a seat with `invitedById`): they join the CALL only, never the
 *    conversation; anybody in the call may do it, a guest excepted;
 *  - the hosts — whoever started the call, the conversation's moderators (a meeting: the space's ADMIN), the OWNER —
 *    take somebody out, mute them (never the owner himself, never yourself), and end the call for everybody;
 *  - an ended call takes nobody, and a removed seat gets no new pass.
 */

export interface CallFacts {
  orgId: string;
  spaceId: string | null;
  conversationId: string | null;
  startedById: string;
  endedAt: Date | null;
  /** the viewer's seat in this call, when they have one */
  seat: { invited: boolean; removed: boolean } | null;
  /** a conversation's call: may the viewer read that conversation? */
  readsConversation: boolean;
  /** a conversation's call: may the viewer moderate it? */
  moderatesConversation: boolean;
  /** the viewer is one of the people of the call's space (ACTIVE, a row in it, or the OWNER) */
  inSpace: boolean;
  /** the viewer's role in the call's space */
  viewerSpaceRole: "ADMIN" | "MEMBER" | "GUEST" | null;
}

function ofThisOrg(call: CallFacts | null, org: OrgFacts | null): call is CallFacts {
  return !!call && isActiveOf(org) && org!.orgId === call.orgId;
}

/**
 * May the viewer start a call in this conversation? Writing there comes first. `selfDm` (C3a.3): the conversation is a private chat of the viewer with themselves
 * («الرسائل المحفوظة»): nobody else is there to ring, so there is no call.
 */
export function canStartCall(facts: ConversationFacts | null, org: OrgFacts | null, opts: { selfDm?: boolean } = {}): boolean {
  if (!facts || !org || !isActiveOf(org) || facts.orgId !== org.orgId) return false;
  if (opts.selfDm === true) return false;
  return canPost(facts, org, { ownerJoined: facts.viewerIsMember });
}

/** May the viewer open a meeting (a link) in this space? Its people, a guest excepted, and the OWNER. */
export function canStartMeeting(org: OrgFacts | null, inSpace: boolean): boolean {
  if (!isActiveOf(org)) return false;
  if (isOwnerOf(org)) return true;
  return org!.role !== "GUEST" && inSpace;
}

/** May the viewer see this call and get a pass into it? */
export function canJoinCall(call: CallFacts | null, org: OrgFacts | null): boolean {
  if (!ofThisOrg(call, org)) return false;
  if (call.endedAt) return false;
  if (hasOversight(org)) return true; // nobody takes the silent eye out, and he may join any call
  if (call.seat?.removed) return false;
  if (call.conversationId) return call.readsConversation || (!!call.seat?.invited && call.inSpace);
  return call.inSpace;
}

/** May the viewer ring somebody else of the space into this call? */
export function canInviteToCall(call: CallFacts | null, org: OrgFacts | null): boolean {
  return canJoinCall(call, org) && org!.role !== "GUEST";
}

/**
 * Does the viewer run this call: whoever started it, the conversation's moderators (a meeting: the space's ADMIN), the
 * OWNER? They take people out, mute them, and end the call for everybody (the owner's «زر انهاء مكالمة لمنشئ»).
 */
export function isCallHost(call: CallFacts | null, org: OrgFacts | null, viewerId: string): boolean {
  if (!canJoinCall(call, org)) return false;
  if (isOwnerOf(org) || call!.startedById === viewerId) return true;
  return call!.conversationId ? call!.moderatesConversation : isSpaceAdmin(call!.viewerSpaceRole);
}

/** May the viewer take `target` out of this call? A host, never the owner, never themselves (they leave). */
export function canRemoveFromCall(
  call: CallFacts | null,
  org: OrgFacts | null,
  viewerId: string,
  target: { userId: string; role: string },
): boolean {
  if (target.role === "OWNER" || target.userId === viewerId) return false;
  return isCallHost(call, org, viewerId);
}

/** May the viewer mute `target`'s microphone? The same as taking them out: a host, never the owner, never themselves. */
export const canMuteInCall = canRemoveFromCall;

/** May the viewer end the call for everybody? A host. Everybody else only leaves (the call goes on without them). */
export function canEndCall(call: CallFacts | null, org: OrgFacts | null, viewerId: string): boolean {
  return isCallHost(call, org, viewerId);
}

// ---------- DB loader ----------

/** An ACTIVE person of the company who is not a guest. */
export async function isCompanyStaff(orgId: string, userId: string): Promise<boolean> {
  const org = await loadOrgFacts(userId, orgId);
  return isActiveOf(org) && org!.role !== "GUEST";
}

export interface LoadedCall {
  facts: CallFacts;
  org: OrgFacts | null;
}

/** Everything the rules need about one call for one viewer; null when the call does not exist. */
export async function loadCallFacts(userId: string, callId: string): Promise<LoadedCall | null> {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: { orgId: true, spaceId: true, conversationId: true, startedById: true, endedAt: true },
  });
  if (!call) return null;
  const [org, seat, spaceRow, inSpace, conv] = await Promise.all([
    loadOrgFacts(userId, call.orgId),
    db.callPerson.findUnique({ where: { callId_userId: { callId, userId } }, select: { invitedById: true, removedAt: true } }),
    call.spaceId
      ? db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: call.spaceId, userId } }, select: { role: true } })
      : Promise.resolve(null),
    // a DM from before spaces had DMs is the company's: its "space" is the company's staff
    call.spaceId ? isOfSpace(call.orgId, call.spaceId, userId) : isCompanyStaff(call.orgId, userId),
    call.conversationId ? loadConversationFacts(userId, call.conversationId) : Promise.resolve(null),
  ]);
  return {
    org,
    facts: {
      ...call,
      seat: seat ? { invited: !!seat.invitedById, removed: !!seat.removedAt } : null,
      readsConversation: !!conv && canRead(conv, org),
      moderatesConversation: !!conv && canModerate(conv, org),
      inSpace,
      viewerSpaceRole: spaceRow?.role ?? null,
    },
  };
}
