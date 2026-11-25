import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCompanySettings } from "@/server/services/control-panel";
import { panelSectionHref } from "@/lib/legacy-routes";
import { OrgNameForm } from "@/components/org-name-form";
import { ServerHealthCard } from "@/components/server-health-card";
import { SystemTokensCard } from "@/components/system-tokens-card";
import { CompanySettingsForm } from "@/components/control-panel/company-settings-form";
import { SectionHeader } from "@/components/control-panel/frame";
import type { SectionCtx } from "./board-sections";

/**
 * «إعدادات الشركة» — the company's name, the box's health card and the system tokens (all MOVED from /settings, the same cards under the same OWNER-rank rule), and what only the OWNER sets for everybody and had no screen: the company's time zone,
 * the page the site opens on, the two pinned work tools of «الشغل» and the order of the menu (A2.1, `CompanySettingsForm`). The chat settings of the company are a group of
 * «الميزات» (C4.3): one link, no second copy. The OWNER rank alone (404 for everybody else, from the section list and again here).
 */
export async function CompanySection({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  if (!actor.isOwner) return notFound();
  const view = await loadCompanySettings(actor);
  return (
    <div className="space-y-4" data-testid="cp-company">
      <SectionHeader t={t} section="company" hint={t("cpv2.company.hint")} />
      <section className="space-y-2 rounded-card border border-border bg-surface-1 p-4 shadow-card" aria-labelledby="cs-name">
        <h3 id="cs-name" className="text-sm font-semibold">
          {t("settings.org")}
        </h3>
        <OrgNameForm organizationId={actor.orgId} initialName={view.name} />
      </section>
      <CompanySettingsForm initial={{ timezone: view.timezone, landing: view.landing, workTabs: view.workTabs, dueHour: view.dueHour, menuOrder: view.menuOrder, personalOrders: view.personalOrders }} />
      <p className="text-xs leading-5 text-fg-muted">
        {t("cpv2.company.chat_link")}{" "}
        <Link href={panelSectionHref("features", undefined, ctx.oneDoor === true)} className="text-info underline">
          {t("cpv2.section.features")}
        </Link>
      </p>
      <ServerHealthCard />
      {/* «توكنات الأنظمة» (W1): the owner rank's tokens for the systems that call Zaki Workspace (MOVED from /settings, same card, same rule) */}
      <SystemTokensCard />
    </div>
  );
}
