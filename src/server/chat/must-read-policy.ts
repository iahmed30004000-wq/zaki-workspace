import type { OrgAccessContext } from "@/server/auth";
import { memberCan } from "@/server/policy/actor";
import { canModerate, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";

/** Who may mark a message «لازم ينقرأ» (Q1.6): in a TOPIC, its moderators and the holders of «إعلانات للجميع» (`announce.send`). The switch is checked by the caller. */
export async function canMark(ctx: OrgAccessContext, facts: ConversationFacts, org: OrgFacts): Promise<boolean> {
  if (facts.kind !== "TOPIC") return false;
  return canModerate(facts, org) || (await memberCan(ctx, "announce.send")) === true;
}
