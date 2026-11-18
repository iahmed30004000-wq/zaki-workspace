/**
 * C2.1 — which screen of the chat an address is, for the shell that stays mounted between them (`src/app/(app)/chat/layout.tsx`).
 *
 *   /chat                 the list (the computer shows the empty pane beside it; the phone shows the list as the screen)
 *   /chat/s/<spaceId>     the forum view of one space, drawn INSIDE the list column (C2.3)
 *   /chat/<id>[/...]      one conversation (the pane; the phone shows it full screen)
 *
 * Pure: the shell, the list and the tests read the same function, so «which row is selected» and «which screen is on the phone» can
 * never disagree.
 */
export type ChatRoute =
  | { kind: "list" }
  | { kind: "forum"; spaceId: string }
  | { kind: "conversation"; id: string }
  | { kind: "other" };

function decode(part: string): string | null {
  try {
    const out = decodeURIComponent(part);
    return out ? out : null;
  } catch {
    return null;
  }
}

export function chatRouteOf(pathname: string | null | undefined): ChatRoute {
  const path = (pathname ?? "").split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "chat") return { kind: "other" };
  if (parts.length === 1) return { kind: "list" };
  if (parts[1] === "s") {
    const spaceId = parts[2] ? decode(parts[2]) : null;
    return spaceId && parts.length === 3 ? { kind: "forum", spaceId } : { kind: "other" };
  }
  const id = decode(parts[1]!);
  return id ? { kind: "conversation", id } : { kind: "other" };
}

/** The phone shows the list column as the whole screen on these, and the page's own content (the conversation) on every other. */
export function isListScreen(route: ChatRoute): boolean {
  return route.kind === "list" || route.kind === "forum";
}

/** The conversation whose row is highlighted, or null. */
export function selectedConversationId(route: ChatRoute): string | null {
  return route.kind === "conversation" ? route.id : null;
}

export const chatHref = {
  list: "/chat",
  forum: (spaceId: string): string => `/chat/s/${encodeURIComponent(spaceId)}`,
  conversation: (id: string): string => `/chat/${encodeURIComponent(id)}`,
} as const;

/**
 * Which space's forum view the list column holds open. The forum is the column and a topic is the pane, so opening a topic from the forum must NOT
 * take the forum away: while a conversation is open the column keeps the forum it had, as long as that conversation is one of its topics (once the
 * topics are known). `/chat/s/<id>` opens one, `/chat` and any other page closes it. Pure, so the rule is pinned without a browser.
 */
export function nextForumSpace(route: ChatRoute, current: string | null, topicIds: readonly string[]): string | null {
  if (route.kind === "forum") return route.spaceId;
  if (route.kind !== "conversation") return null;
  if (current && topicIds.length > 0 && !topicIds.includes(route.id)) return null;
  return current;
}

/** What the column draws as the forum right now (the address wins on a forum page; on a conversation it is the kept one). */
export function forumShown(route: ChatRoute, kept: string | null): string | null {
  return route.kind === "forum" ? route.spaceId : route.kind === "conversation" ? kept : null;
}
