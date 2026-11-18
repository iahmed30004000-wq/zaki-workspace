import type { Actor } from "@/server/policy/actor";
import { actorCan } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";

/**
 * C2.4 — the switch of the conversation page, in ONE place (server only): `null` while «شاشة الدردشة الجديدة» (`chatLayoutV2`) is OFF — the page then draws
 * today's `ConversationPageClient` unchanged — and, with it ON, what the pane is told that only the SERVER knows: whether «نتفرّج سوا» may be offered in the
 * header's «⋮» (the company's switch for it, the person's box for it, and never an external partner). The pane decides nothing about access itself; every
 * door decides again when it is used.
 *
 * It reads the same per-request cached company settings as the chat layout (`isFeatureOn`), so the page, the layout and this agree inside a request.
 */
export async function paneSwitch(actor: Pick<Actor, "orgId" | "isExternal" | "caps">): Promise<{ watch: boolean } | null> {
  if (!(await isFeatureOn(actor.orgId, "chatLayoutV2"))) return null;
  const watch = !actor.isExternal && actorCan(actor, "watch.view") && (await isFeatureOn(actor.orgId, "watch"));
  return { watch };
}
