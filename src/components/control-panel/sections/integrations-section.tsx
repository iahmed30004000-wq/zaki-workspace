import { notFound } from "next/navigation";
import { integrationPartOf, type IntegrationPart } from "@/lib/control-panel";
import { panelSectionHref } from "@/lib/legacy-routes";
import { companyPanelAccess, integrationPartsOf } from "@/server/services/control-panel";
import { loadAiPlace } from "@/server/services/ai-settings";
import { isFeatureOn } from "@/server/services/features";
import { ZakiAiPanel } from "@/components/control-panel/zaki-ai";
import { SettingsForm } from "@/components/owner-assistant/settings-form";
import { PartNav, SectionHeader } from "@/components/control-panel/frame";
import { OmsEventsCard } from "@/components/control-panel/oms-events-card";
import { AutomationBody, TelegramBody } from "./integrations-bodies";
import type { SectionCtx } from "./board-sections";

/**
 * «التكاملات» — ONE place for everything the company is connected to (A2.1): n8n and the workflows, Google Drive, the API door's tokens, the encrypted backup, mail → task
 * and the link to the orders system (the cards of /automation, MOVED), the orders system's events card, the Telegram bot (/telegram, MOVED) and the AI connection.
 * (The tokens of the systems that call Zaki Workspace are the OWNER rank's, as they were on /settings: they sit in «إعدادات الشركة», not behind `integrations.manage`.)
 *
 * THE AI CONNECTION IS ONE PLACE: the two forms the owner used to find (the gateway form of «ذكي أي أي» and the key / model / local model / gateway form of «مساعد المالك»)
 * both wrote the same AiSettings row; here the status of «ذكي أي أي» (is it connected, the test, the fixed address) sits on top of the ONE form that edits that row
 * (`SettingsForm`), and the gateway fields exist once. The cards that are the owner's alone stay owner-only (the backup, the mailbox, the orders system's token, the AI).
 */
export async function IntegrationsSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, searchParams, t } = ctx;
  const allowed = await integrationPartsOf(actor);
  if (allowed.length === 0) return notFound();
  const asked = searchParams["part"];
  const part: IntegrationPart = integrationPartOf(Array.isArray(asked) ? asked[0] : asked);
  // a part the person may not open (the AI connection is the owner's) is «not found», like a section
  if (!allowed.includes(part)) return notFound();
  // S3.3: inside the settings frame (`ctx.oneDoor`) the parts are addresses of the frame, not of the panel
  const parts = allowed.map((key) => ({ key, href: panelSectionHref("integrations", key, ctx.oneDoor === true), name: t(`cpv2.integrations.part.${key}`), current: key === part }));
  return (
    <div className="space-y-4" data-testid="cp-integrations" data-part={part}>
      <SectionHeader t={t} section="integrations" hint={t("cpv2.integrations.hint")} />
      <PartNav label={t("cpv2.integrations.nav")} parts={parts} />
      {part === "automation" ? (
        <div className="space-y-6">
          <AutomationBody actor={actor} />
          {actor.isOwner && (await isFeatureOn(actor.orgId, "omsEvents")) ? <OmsEventsCard /> : null}
        </div>
      ) : null}
      {part === "telegram" ? await TelegramBody({ actor }) : null}
      {part === "ai" ? await AiPart({ ctx }) : null}
    </div>
  );
}

/**
 * The ONE AI place: the status of the agent (when the first panel's access holds) and the single form of AiSettings. While the owner's assistant is off its form
 * is not available, so the status panel keeps its own connect form (still exactly one form on the screen).
 */
async function AiPart({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  const [place, status] = await Promise.all([loadAiPlace(actor), companyPanelAccess(actor)]);
  return (
    <div className="space-y-6" data-testid="cp-ai">
      <p className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs leading-5 text-fg-muted">{t("cpv2.ai.one_place")}</p>
      {status ? <ZakiAiPanel single={place !== null} /> : null}
      {place ? <SettingsForm settings={place.settings} usage={place.usage} models={place.models} /> : null}
    </div>
  );
}
