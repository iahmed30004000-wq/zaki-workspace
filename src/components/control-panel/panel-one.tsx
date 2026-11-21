import { notFound, redirect } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { carriedQuery, oneDoorHref } from "@/lib/legacy-routes";
import { FIRST_SECTION, PANEL_ONE_NAV, isOneDoorSettingsSection, isPanelSection, legacyPanelTarget, panelOneNavFor, peoplePartsFor, type IntegrationPart, type PanelOneNavKey } from "@/lib/control-panel";
import type { Actor } from "@/server/policy/actor";
import { integrationPartsOf, type PanelAccess } from "@/server/services/control-panel";
import { PanelFrame } from "./frame";
import { OverviewSection, type SectionCtx } from "./sections/board-sections";
import { PeopleOneSection } from "./sections/people-section";
import { ReportsSection } from "./sections/reports-section";
import { StructureSection } from "./sections/structure-section";
import { ArchiveSection, AssistantSection } from "./sections/small-sections";

/**
 * «لوحة التحكم» with ONE navigation (S3.2, the switch `settingsOneDoor`, which needs `controlPanelV2`): the panel is a place of its own and its list is the only list: نظرة عامة · الناس ·
 * التقارير · الهيكل والأداء · الأرشيف والرقابة · مساعد المالك. What is a SETTING (the spaces, the switches, the integrations, the company's data) is «إعدادات الشركة» of the settings frame:
 * those old addresses (`/owner?s=features`, …) lead there, and «الحسابات والصلاحيات» (`?s=accounts`) is the part `accounts` of «الناس». The list is `panelSectionsFor`'s, re-grouped by
 * `panelOneNavFor`: no rule of its own here, and every body decides again on its own. A person who may open none of the six but a settings section is sent to it, never to an empty panel.
 */
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

async function bodyOf(section: PanelOneNavKey, ctx: SectionCtx) {
  switch (section) {
    case "overview":
      return OverviewSection({ ctx });
    case "people":
      return PeopleOneSection({ ctx });
    case "reports":
      return ReportsSection({ ctx });
    case "structure":
      return StructureSection({ ctx });
    case "archive":
      return ArchiveSection({ ctx });
    case "assistant":
      return AssistantSection({ ctx });
  }
}

export async function ControlPanelOneDoor({ actor, access, searchParams }: { actor: Actor; access: PanelAccess; searchParams: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  const carried = carriedQuery(searchParams);
  const nav = panelOneNavFor(access.sections);

  // the first panel's `?v=` (people, reports, the AI part): where its section lives now, with the filters it carried
  const legacy = legacyPanelTarget(first(searchParams["v"]));
  const partOffered = !legacy || legacy.section !== "integrations" || !legacy.part || (await integrationPartsOf(actor)).includes(legacy.part as IntegrationPart);
  if (legacy && partOffered && (access.sections.includes(legacy.section) || (legacy.section === "people" && nav.includes("people")))) {
    // the old `?v=people` was the activity table: it still is, for whoever holds that part (anybody else lands on the first part they have)
    const activity = legacy.section === "people" && peoplePartsFor(access.sections, actor.isOwner).includes("activity");
    redirect(oneDoorHref(activity ? { ...legacy, part: "activity" } : legacy, carried));
  }

  // an address of the eleven-section panel: «الحسابات والصلاحيات» is a part of «الناس», the settings sections are «إعدادات الشركة» (a section the person may not open stays «not found»)
  // (an empty `?s=` is no section: the first entry opens, as for the bare address)
  const asked = first(searchParams["s"]) || undefined;
  if (asked === "accounts" || isOneDoorSettingsSection(asked)) {
    if (!isPanelSection(asked) || !access.sections.includes(asked)) notFound();
    redirect(oneDoorHref({ section: asked, part: first(searchParams["part"]) }, carried));
  }

  // a person who holds only settings sections has nothing to open here: the first of them is the settings frame's
  if (nav.length === 0) {
    const only = access.sections[0];
    if (!only) notFound();
    redirect(oneDoorHref({ section: only }, carried));
  }

  const section = asked ?? (nav.includes(FIRST_SECTION as PanelOneNavKey) ? FIRST_SECTION : nav[0]);
  if (!section || !(PANEL_ONE_NAV as readonly string[]).includes(section) || !nav.includes(section as PanelOneNavKey)) notFound();
  const key = section as PanelOneNavKey;
  const ctx: SectionCtx = { actor, userId: actor.userId, access, searchParams, t, oneDoor: true };
  return (
    <PanelFrame t={t} sections={nav} current={key} oneNav>
      {await bodyOf(key, ctx)}
    </PanelFrame>
  );
}
