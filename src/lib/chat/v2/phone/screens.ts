import { chatHref, chatRouteOf } from "@/lib/chat/v2/routes";

/**
 * C2.8 — the screens of the phone. `chatRouteOf` (routes.ts) tells the list from a conversation for the shell that stays mounted; the phone also has the
 * conversation's INFO screen (`/chat/<id>/info`), and «back» is not the same everywhere: from the info screen it is the conversation, from the conversation
 * the list. The list and the forum view have no back (the app's own drawer or bottom bar is the way out). Pure.
 */
export type PhoneScreen = "list" | "forum" | "conversation" | "info" | "other";

function parts(pathname: string | null | undefined): string[] {
  return ((pathname ?? "").split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
}

export function phoneScreenOf(pathname: string | null | undefined): PhoneScreen {
  const route = chatRouteOf(pathname);
  if (route.kind === "list") return "list";
  if (route.kind === "forum") return "forum";
  if (route.kind !== "conversation") return "other";
  return parts(pathname)[2] === "info" ? "info" : "conversation";
}

/** Where back goes from this address, or null when there is no back (the swipe is then not armed). The segment is kept as written in the address. */
export function phoneBackOf(pathname: string | null | undefined): string | null {
  const screen = phoneScreenOf(pathname);
  if (screen === "conversation" && parts(pathname).length === 2) return chatHref.list;
  if (screen === "conversation" || screen === "info") return `/chat/${parts(pathname)[1]}`;
  return null;
}
