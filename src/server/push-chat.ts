import { featureOn } from "@/lib/features";
import { goHref } from "@/lib/space-link";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { pushTo } from "@/server/calls/push";

/**
 * M1a — a chat message's Web Push WITHOUT a bell row. A private chat pushes every message, but the bell keeps ONE row per unread chat (a row per message would
 * stack the bell, which `src/server/chat/notify.ts` has never done): the first message of an unread run goes through `pushNotification` (row + push), each
 * follow-up goes through here (push only).
 *
 * It is the same send as the one behind `pushNotification` (`pushOut` in `src/server/notify.ts`, which is private to that file): the person's company switch
 * «إشعارات على التلفون واللابتوب» (`pushEverything`), the page through `/go` for a space's notification, and the same `chat_message:<page>` tag the worker
 * (`public/sw.js`) turns into the conversation's own tag. The tag of a follow-up is the CONVERSATION's page, not the message's: a client that honours the tag
 * (the Android app's live line) shows one notification for the follow-ups of a chat instead of one per message. Best effort and never in the way: a failure is logged and never reaches the message that caused it.
 */
const pending = new Set<Promise<void>>();

/** Test hook: wait for the pushes sent so far (never call from server code). */
export async function flushChatPushesForTests(): Promise<void> {
  await Promise.all([...pending]);
}

export function pushChatNote(userIds: readonly string[], note: { title: string; body: string; linkUrl: string; conversationId: string; workspaceId?: string | null }): void {
  const job = (async () => {
    if (userIds.length === 0) return;
    const rows = await db.organizationMember.findMany({
      where: { userId: { in: [...userIds] }, status: "ACTIVE" },
      select: { userId: true, organization: { select: { settings: true } } },
    });
    const on = [...new Set(rows.filter((r) => featureOn(r.organization.settings, "pushEverything")).map((r) => r.userId))];
    if (on.length === 0) return;
    const url = note.workspaceId && !note.linkUrl.startsWith("/go?") ? goHref(note.workspaceId, note.linkUrl) : note.linkUrl;
    await pushTo(on, { kind: "note", title: note.title, body: note.body, url, tag: `chat_message:/chat/${note.conversationId}` });
  })().catch((err) => log.warn("push.chat_note_failed", { message: err instanceof Error ? err.message : String(err) }));
  pending.add(job);
  void job.finally(() => pending.delete(job));
}
