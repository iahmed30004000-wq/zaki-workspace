import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { CHAT_PREFS_MAX_BYTES, chatPrefsBytes, mergeChatPrefs, readChatPrefs, type ChatPrefs, type ChatPrefsPatch } from "@/lib/chat/prefs";

/**
 * C3a.2 — the person's own chat preferences, kept on their account (`User.chatPrefs`, one nullable JSON column; the schema is `src/lib/chat/prefs.ts`).
 *
 * It is PERSONAL: every function takes the person's id from the session and nothing else, so nobody reads or writes another person's prefs. A save is a
 * PATCH merged under a row lock (two devices saving different sections both stay), refused when the result would pass 64 KB.
 *
 * The switch `chatFolders` covers the folders and the tabs only: with it off they are not answered and cannot be saved (404), while the other sections
 * (C4.1's, the voice speed of C3b.4) keep working because they do not belong to it. What was stored stays.
 */

export interface ChatPrefsAnswer {
  prefs: ChatPrefs;
  /** the person's active company: the folders of the screen are the ones keyed by it */
  orgId: string;
  /** the company's switch `chatFolders` */
  foldersOn: boolean;
}

const activeOrgIds = async (userId: string): Promise<Set<string>> =>
  new Set((await db.organizationMember.findMany({ where: { userId, status: "ACTIVE" }, select: { organizationId: true } })).map((m) => m.organizationId));

/** What the person is told: the folders of the companies they belong to, and nothing of the folders at all while the switch is off. */
async function answerOf(actor: Pick<Actor, "userId" | "orgId">, stored: ChatPrefs, known?: Set<string>): Promise<ChatPrefsAnswer> {
  const foldersOn = await isFeatureOn(actor.orgId, "chatFolders");
  const prefs: ChatPrefs = { ...stored };
  if (!foldersOn) {
    delete prefs.folders;
    delete prefs.tabs;
  } else if (prefs.folders) {
    const orgs = known ?? (await activeOrgIds(actor.userId));
    const mine = Object.fromEntries(Object.entries(prefs.folders).filter(([org]) => orgs.has(org)));
    if (Object.keys(mine).length > 0) prefs.folders = mine;
    else delete prefs.folders;
  }
  return { prefs, orgId: actor.orgId, foldersOn };
}

/** The person's prefs (an empty object: all defaults). A stored value that is damaged reads as what is still good, never as an error. */
export async function getMyChatPrefs(actor: Pick<Actor, "userId" | "orgId">): Promise<ChatPrefsAnswer> {
  const row = await db.user.findUnique({ where: { id: actor.userId }, select: { chatPrefs: true } });
  return answerOf(actor, readChatPrefs(row?.chatPrefs));
}

/**
 * Saves a patch (`patch` is already schema-valid). Refused with nothing written: the folders or the tabs while `chatFolders` is off (404), folders keyed
 * by a company the person is not an active member of (403 `chatprefs.not_your_company`; dropping such a list is allowed), a result over 64 KB (422 `chatprefs.too_big`).
 */
export async function saveMyChatPrefs(actor: Pick<Actor, "userId" | "orgId">, patch: ChatPrefsPatch): Promise<ChatPrefsAnswer> {
  if (patch.folders !== undefined || patch.tabs !== undefined) await assertFeatureOn(actor.orgId, "chatFolders");
  // a list for a company the person is not in is refused; dropping one (null, or an empty list) never is, so a company they left can be cleaned up
  let orgs: Set<string> | undefined;
  if (patch.folders) {
    orgs = await activeOrgIds(actor.userId);
    for (const [org, list] of Object.entries(patch.folders)) {
      if (list !== null && list.length > 0 && !orgs.has(org)) throw new ForbiddenError("chatprefs.not_your_company");
    }
  }

  const next = await db.$transaction(async (tx) => {
    // one save of one person at a time: a read-merge-write that two devices race would lose a section
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.userId} FOR UPDATE`;
    const row = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { chatPrefs: true } });
    const merged = mergeChatPrefs(readChatPrefs(row.chatPrefs), patch);
    if (chatPrefsBytes(merged) > CHAT_PREFS_MAX_BYTES) throw new ValidationError([{ path: "body", message: "chatprefs.too_big" }]);
    const empty = Object.keys(merged).length === 0;
    await tx.user.update({ where: { id: actor.userId }, data: { chatPrefs: empty ? Prisma.DbNull : (merged as Prisma.InputJsonValue) } });
    return merged;
  });
  return answerOf(actor, next, orgs);
}
