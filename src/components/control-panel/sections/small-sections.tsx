import { notFound } from "next/navigation";
import { actorCan } from "@/server/policy/actor";
import { mayOverview } from "@/server/services/spaces-overview";
import { SectionHeader } from "@/components/control-panel/frame";
import { ArchiveBody } from "./archive-body";
import { AssistantBody, assistantOrMiss } from "./assistant-bodies";
import { SpacesBody } from "./spaces-body";
import type { SectionCtx } from "./board-sections";

/**
 * «المساحات» (`/spaces`: the cards of every space, with their settings in place), «الأرشيف والرقابة» (`/archive`) and «مساعد المالك» (`/owner/assistant`): three screens MOVED
 * into the panel as they were. Each asks its own rule again (the section list is only what is offered): the rank rule of the spaces board, the capability `archive.view`,
 * and the assistant's own access (the OWNER rank, the switch on).
 */
export async function SpacesSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  if (!mayOverview(actor)) return notFound();
  return (
    <div className="space-y-4" data-testid="cp-spaces">
      <SectionHeader t={t} section="spaces" hint={t("cpv2.spaces.hint")} />
      {await SpacesBody({ actor, heading: "h2" })}
    </div>
  );
}

export async function ArchiveSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  if (!actorCan(actor, "archive.view")) return notFound();
  return (
    <div className="space-y-4" data-testid="cp-archive">
      <SectionHeader t={t} section="archive" />
      {await ArchiveBody({ heading: "h2" })}
    </div>
  );
}

export async function AssistantSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, searchParams, t } = ctx;
  return (
    <div className="space-y-4" data-testid="cp-assistant">
      <SectionHeader t={t} section="assistant" />
      {await AssistantBody({ access: await assistantOrMiss(actor), searchParams })}
    </div>
  );
}
