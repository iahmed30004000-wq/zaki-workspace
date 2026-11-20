import { notFound, redirect } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { carriedQuery } from "@/lib/legacy-routes";
import { legacyPanelTarget, myBoardHref, panelHref, type PanelSectionKey } from "@/lib/control-panel";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertPanelSection, integrationPartsOf, panelAccess, type PanelAccess } from "@/server/services/control-panel";
import type { IntegrationPart } from "@/lib/control-panel";
import { PanelFrame } from "./frame";
import { OverviewSection, PeopleSection, type SectionCtx } from "./sections/board-sections";
import { ReportsSection } from "./sections/reports-section";
import { AccountsSection } from "./sections/accounts-section";
import { FeaturesSection } from "./sections/features-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { StructureSection } from "./sections/structure-section";
import { CompanySection } from "./sections/company-section";
import { ArchiveSection, AssistantSection, SpacesSection } from "./sections/small-sections";

/**
 * «لوحة التحكم» as ONE page (A2.1, switch `controlPanelV2`): `/owner` with a side list of the sections the person may open and the section they asked for (`?s=`). Every
 * section is a server read and decides its own access again; the page decides only what is OFFERED (`panelAccess`):
 *   - a guest, or a person who may open no section, gets «not found» — except a person who holds `board.self`, who is sent to their own page «لوحتي» (`/owner/people/<their id>`, `myBoardHref`);
 *   - a section the person may not open, or that does not exist, is «not found» (never «forbidden»): the panel does not say what it holds;
 *   - the old `?v=people|reports|ai` of the first panel leads to the section that now holds it (filters carried).
 * Reading writes nothing: no audit row, no notification, no «seen».
 */
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

async function bodyOf(section: PanelSectionKey, ctx: SectionCtx) {
  switch (section) {
    case "overview":
      return OverviewSection({ ctx });
    case "people":
      return PeopleSection({ ctx });
    case "reports":
      return ReportsSection({ ctx });
    case "accounts":
      return AccountsSection({ ctx });
    case "spaces":
      return SpacesSection({ ctx });
    case "features":
      return FeaturesSection({ ctx });
    case "integrations":
      return IntegrationsSection({ ctx });
    case "structure":
      return StructureSection({ ctx });
    case "archive":
      return ArchiveSection({ ctx });
    case "assistant":
      return AssistantSection({ ctx });
    case "company":
      return CompanySection({ ctx });
  }
}

export async function ControlPanelV2({ actor, searchParams }: { actor: Actor; searchParams: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  let access: PanelAccess;
  try {
    access = await panelAccess(actor);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    // nothing to open: their own page is still theirs (D-A6), anybody else is nobody
    if (!actor.isExternal && actor.caps.has("board.self") && err.message === "cpv2.not_found") redirect(myBoardHref(actor.userId));
    notFound();
  }

  // the first panel's `?v=` (people, reports, the AI part): its section, with the filters it carried
  const legacy = legacyPanelTarget(first(searchParams["v"]));
  const partOffered = !legacy || legacy.section !== "integrations" || !legacy.part || (await integrationPartsOf(actor)).includes(legacy.part as IntegrationPart);
  if (legacy && partOffered && access.sections.includes(legacy.section)) {
    redirect(panelHref(legacy.section, legacy.part, carriedQuery(searchParams)));
  }

  let section: PanelSectionKey;
  try {
    section = assertPanelSection(access, first(searchParams["s"]));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const ctx: SectionCtx = { actor, userId: actor.userId, access, searchParams, t };
  return (
    <PanelFrame t={t} sections={access.sections} current={section}>
      {await bodyOf(section, ctx)}
    </PanelFrame>
  );
}
