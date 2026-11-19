import type { ConversationDto } from "@/server/chat/dto";
import { customerDataHint, type CustomerDataHint } from "@/lib/chat/customer-data-hint";

/**
 * C2.5 — the Q1.7 customer-data hint, shown under the box WHILE the words are typed (the same line the author sees under the sent message, `CustomerHint` of the
 * bubble). The same rule as the bubble's: the company's switch (`me.orderHints`, already false for a guest), an OPEN topic only (never a private chat, a
 * restricted topic or a team's), and a text. NOTHING is blocked, hidden or changed: it is a line, and the message goes out as typed. The text is looked at
 * here, on this device, and is sent nowhere.
 */
export function composerHintOf(text: string, detail: Pick<ConversationDto, "kind" | "restricted" | "teamId"> & { me: Pick<ConversationDto["me"], "orderHints"> }, editing = false): CustomerDataHint {
  if (editing || !detail.me.orderHints) return null;
  if (detail.kind !== "TOPIC" || detail.restricted || detail.teamId) return null;
  return text.trim() ? customerDataHint(text) : null;
}
