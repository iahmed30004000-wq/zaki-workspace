import { notFound } from "next/navigation";
import { panelHref, structurePartOf, STRUCTURE_PARTS } from "@/lib/control-panel";
import { PartNav, SectionHeader } from "@/components/control-panel/frame";
import { DevelopmentBody, StructureBody, type DevelopmentWhere } from "./development-body";
import type { SectionCtx } from "./board-sections";

/**
 * «الهيكل والتطوير» — «الأداء والتطوير» (the people's scores and files, `/development`) and «الهيكل» (who answers to whom, `/structure`), MOVED: the same bodies, drawn
 * inside the panel with their links and the period form pointing at the section. The section list offers it to an owner, a line manager and a supervisor; a person who
 * reads nobody but themselves keeps their own file on `/development` (the page the old address still is). The services decide who reads whom (`devAccess`).
 */
export async function StructureSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, searchParams, t } = ctx;
  const asked = searchParams["part"];
  const part = structurePartOf(Array.isArray(asked) ? asked[0] : asked);
  const developmentWhere: DevelopmentWhere = {
    action: "/owner",
    hidden: { s: "structure", part: "development" },
    hrefOf: (query) => panelHref("structure", "development", query),
    structureHref: panelHref("structure", "structure"),
    developmentHref: panelHref("structure", "development"),
    heading: "h2",
  };
  const parts = STRUCTURE_PARTS.map((key) => ({ key, href: panelHref("structure", key), name: t(`cpv2.structure.part.${key}`), current: key === part }));
  return (
    <div className="space-y-4" data-testid="cp-structure" data-part={part}>
      <SectionHeader t={t} section="structure" hint={t("cpv2.structure.hint")} />
      <PartNav label={t("cpv2.structure.nav")} parts={parts} />
      {part === "development" ? await DevelopmentBody({ actor, searchParams, where: developmentWhere }) : part === "structure" ? await StructureBody({ actor, where: developmentWhere }) : notFound()}
    </div>
  );
}
