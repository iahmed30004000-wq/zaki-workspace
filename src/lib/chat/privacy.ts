import { ct, ctCount } from "@/lib/chat/text";

/**
 * P0.4 — «مين بيشوفها؟» on screen. A conversation is in one of four states; the head, the row and the sheet say which.
 * Everything here is words only: who may really read is decided on the server (src/server/policy/conversation.ts).
 */
export type PrivacyState = "open" | "restricted" | "team" | "dm";

export function privacyState(c: { kind: string; restricted?: boolean | null; teamId?: string | null }): PrivacyState {
  if (c.kind !== "TOPIC") return "dm";
  if (c.restricted) return "restricted";
  if (c.teamId) return "team";
  return "open";
}

/** The line under the title: «🔒 خاص · 4 أشخاص». An open topic has none (the space's name stays). */
export function privacyLabel(state: PrivacyState, peopleCount: number): string | null {
  if (state === "open") return null;
  if (state === "dm") return ct("chatp.label.dm");
  return ct(`chatp.label.${state}`, { people: ctCount("chatp.people", peopleCount) });
}

/** «رح يشوفه: …» in the topic's settings, before saving. */
export function visibleToLine(
  who: { audience: "people"; names: string[] } | { audience: "space"; spaceName: string } | { audience: "section"; sectionName: string },
): string {
  if (who.audience === "space") return ct("chatp.visible_space", { name: who.spaceName });
  if (who.audience === "section") return ct("chatp.visible_section", { name: who.sectionName });
  return who.names.length ? ct("chatp.visible_to", { names: who.names.join("، ") }) : ct("chatp.visible_none");
}
