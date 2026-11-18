import { featureOn } from "@/lib/features";
import { landingOf } from "@/server/policy/org-settings";
import { orgSummaryOf } from "@/server/services/features";

/**
 * N1.8 — does «/» alone send this person to the chat? True only while the company's switch `navV2` is ON and its setting `landing` is «الدردشة»
 * (the default). With `navV2` OFF nothing changes. Read from the company's settings that the request already holds (one read per request).
 */
export async function landsOnChat(actor: { orgId: string }): Promise<boolean> {
  const org = await orgSummaryOf(actor.orgId);
  return featureOn(org?.settings, "navV2") && landingOf(org?.settings) === "chat";
}
