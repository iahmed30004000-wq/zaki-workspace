import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { fetchWindow, hasMessage, isNotFound, reachesNewest, showAround, showWindow } from "@/lib/chat/cache/pages";
import { LATEST, type MessagesData, type MessagesParam } from "@/lib/chat/cache/types";
import { landingRule, NEWEST, type Landing } from "@/lib/chat/history/landing";

/**
 * C1.6 — opening a conversation: decide the window to show and where to land in it.
 *
 * Whatever the answer, when this resolves the conversation's messages query holds the window to draw (the screen mounts
 * `useChatMessages` only now, so nothing is fetched twice and nothing flashes in the wrong place first).
 *
 * `unreadHint` is the list row's unread number (null: the row is not known, e.g. a link from outside). It only decides whether a
 * conversation already in the cache may open without asking: with something unread the cache cannot know WHICH message is the first
 * unread one (that is the server's answer, and it changes with every read), so the newest window is asked for.
 */
export interface OpenOptions {
  unreadHint: number | null;
  /** `?m=`: a message to open on (a reply quote, a pinned message, a search hit). */
  messageId?: string | null;
  /** is this run still the latest one? A run that was overtaken writes nothing and answers `null`. */
  current?: () => boolean;
}

export async function resolveOpening(qc: QueryClient, conversationId: string, opts: OpenOptions): Promise<Landing | null> {
  const { current } = opts;
  const held = () => qc.getQueryData<MessagesData>(chatKeys.messages(conversationId));

  if (opts.messageId) {
    if (hasMessage(held(), opts.messageId)) return { kind: "message", messageId: opts.messageId };
    try {
      if (!(await showAround(qc, conversationId, opts.messageId, current))) return null;
      return { kind: "message", messageId: opts.messageId };
    } catch (e) {
      // a message that is not there (deleted, purged, another conversation's): the conversation opens the normal way
      if (!isNotFound(e)) throw e;
    }
  }

  // nothing unread, and the windows reach the newest message: it opens from the cache at once (the sync feed keeps it current)
  if (opts.unreadHint === 0 && reachesNewest(held())) return NEWEST;

  const newest = await fetchWindow(qc, conversationId, LATEST);
  const rule = landingRule(newest);
  if (rule.kind !== "unread-outside") {
    if (!(await showWindow(qc, conversationId, newest, LATEST, current))) return null;
    return rule.kind === "newest" ? NEWEST : { kind: "unread", messageId: rule.id };
  }
  const param: MessagesParam = { kind: "around", id: rule.id };
  try {
    const around = await fetchWindow(qc, conversationId, param);
    if (!(await showWindow(qc, conversationId, around, param, current))) return null;
    return { kind: "unread", messageId: rule.id };
  } catch (e) {
    // the first unread message was removed between the two requests: the newest window is still a good place to open
    if (!isNotFound(e)) throw e;
    if (!(await showWindow(qc, conversationId, newest, LATEST, current))) return null;
    return NEWEST;
  }
}
