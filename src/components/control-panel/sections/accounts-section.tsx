import Link from "next/link";
import { notFound } from "next/navigation";
import type { ServerT } from "@/lib/i18n/server";
import { actorCan, type Actor } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";
import { panelHref } from "@/lib/control-panel";
import { OrgMembersView } from "@/components/org-members-view";
import { TemplatesEditor } from "@/components/templates-editor/templates-editor";
import { SectionHeader } from "@/components/control-panel/frame";
import type { SectionCtx } from "./board-sections";

/**
 * The editor of the templates of «قوالب الصلاحيات» (A1.1 built the data, the starters and the door; the screen that names and edits them is this one) for the OWNER rank, and nothing for
 * anybody else: only the OWNER rank edits the list. While the switch `permissionTemplates` is off the editor is not drawn: one line says where to turn it on. Shared by the section
 * «الحسابات والصلاحيات» and by the part «قوالب الصلاحيات» of «الناس» (S3.2): one body, two doors.
 */
export async function TemplatesPart({ actor, t }: { actor: Actor; t: ServerT }) {
  if (actor.role !== "OWNER") return null;
  const templatesOn = await isFeatureOn(actor.orgId, "permissionTemplates");
  return templatesOn ? (
    <TemplatesEditor orgId={actor.orgId} />
  ) : (
    <section className="rounded-card border border-border bg-surface-1 p-4 text-sm" data-testid="cp-templates-off">
      <h3 className="font-semibold">{t("cpv2.accounts.templates_title")}</h3>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{t("cpv2.accounts.templates_off")}</p>
      <Link href={panelHref("features")} className="mt-2 inline-block text-sm text-info underline">
        {t("cpv2.accounts.templates_turn_on")}
      </Link>
    </section>
  );
}

/**
 * «الحسابات والصلاحيات» — the people screen (`/members` for whoever holds `users.manage`, MOVED: one view, not rebuilt) and, for the OWNER rank, the editor of the
 * templates of «قوالب الصلاحيات» (`TemplatesPart`). Only the OWNER rank edits the list: an admin holding `users.manage` lists and applies templates from a person's sheet and sees no editor here.
 */
export async function AccountsSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  if (!actorCan(actor, "users.manage")) return notFound();
  return (
    <div className="space-y-6" data-testid="cp-accounts">
      <SectionHeader t={t} section="accounts" hint={t("cpv2.accounts.hint")} />
      <OrgMembersView orgId={actor.orgId} actorId={actor.userId} actorRole={actor.role} actorCaps={[...actor.caps]} />
      {await TemplatesPart({ actor, t })}
    </div>
  );
}
