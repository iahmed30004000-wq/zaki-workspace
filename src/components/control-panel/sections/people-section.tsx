import { notFound } from "next/navigation";
import { actorCan } from "@/server/policy/actor";
import { OrgMembersView } from "@/components/org-members-view";
import { PartNav, SectionHeader } from "@/components/control-panel/frame";
import { panelHref, peoplePartFromQuery, peoplePartsFor } from "@/lib/control-panel";
import { PeopleSection, type SectionCtx } from "./board-sections";
import { TemplatesPart } from "./accounts-section";

/**
 * «الناس» as ONE section (S3.2, the switch `settingsOneDoor`): the three screens the panel used to spread over two sections are its PARTS, each one the existing body MOVED, not rebuilt:
 *   accounts    «الحسابات والصلاحيات»  the people screen: a card per person, and in the person's own sheet their rank and every permission (`OrgMembersView`, one shared person card);
 *   templates   «قوالب الصلاحيات»      the editor of the templates, for the OWNER rank (`TemplatesPart`);
 *   activity    «النشاط»               the board's people table with its filters (`PeopleSection`).
 * A part is an address, `?s=people&part=<id>`, and a person sees only the parts the panel offers them (`peoplePartsFor`, from the sections `panelSectionsFor` decided); a part they may
 * not open, like a section, is «not found». The body of each part decides again on its own (the capability, the board's reach). Reading writes nothing.
 */
export async function PeopleOneSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, access, searchParams, t } = ctx;
  const parts = peoplePartsFor(access.sections, actor.isOwner);
  const part = peoplePartFromQuery(searchParams, parts);
  if (!part) return notFound();
  const nav = parts.map((key) => ({ key, href: panelHref("people", key), name: t(`cpone.people.part.${key}`), current: key === part }));
  return (
    <div className="space-y-4" data-testid="cp-people-one" data-part={part}>
      <SectionHeader t={t} section="people" hint={t("cpone.people.hint")} title={t("cpone.nav.people")} />
      {nav.length > 1 ? <PartNav label={t("cpone.people.nav")} parts={nav} /> : null}
      {part === "accounts" ? (
        actorCan(actor, "users.manage") ? (
          <OrgMembersView orgId={actor.orgId} actorId={actor.userId} actorRole={actor.role} actorCaps={[...actor.caps]} />
        ) : (
          notFound()
        )
      ) : null}
      {part === "templates" ? await TemplatesPart({ actor, t }) : null}
      {part === "activity" ? await PeopleSection({ ctx, part }) : null}
    </div>
  );
}
