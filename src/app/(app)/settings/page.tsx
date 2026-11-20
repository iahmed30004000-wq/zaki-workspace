import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe, KeyRound, Lock, ToggleRight, Users } from "lucide-react";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { fmtDMY } from "@/lib/format";
import { db } from "@/server/db";
import { actorCan } from "@/server/policy/actor";
import { getServerT } from "@/lib/i18n/server";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { getGoogleStatus } from "@/server/services/google";
import { getIntegration } from "@/server/services/integrations";
import { OrgNameForm } from "@/components/org-name-form";
import { IntegrationBadge } from "@/components/integration-badge";
import { FeatureSwitches } from "@/components/feature-switches";
import { ServerHealthCard } from "@/components/server-health-card";
import { SystemTokensCard } from "@/components/system-tokens-card";
import { PrimitiveSamples } from "@/components/theme/primitive-samples";
import { actorFeatureOn, listFeatures } from "@/server/services/features";
import { panelHref } from "@/lib/control-panel";
import { embedServer } from "@/server/services/search-embeddings";

export default async function SettingsPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  // The company's headcount and which integrations are connected: not for an external partner.
  if (refusedToGuest(actor, "settings")) return <GuestNotice />;

  const org = await db.organization.findUnique({
    where: { id: actor.orgId },
    select: { id: true, name: true, createdAt: true },
  });
  if (!org) redirect("/login");

  const [telegram, n8n, google, membersCount, features] = await Promise.all([
    getIntegration(org.id, "TELEGRAM"),
    getIntegration(org.id, "N8N"),
    getGoogleStatus(org.id),
    // only people who can still use the app: a suspended or offboarded person is not "a member" here
    db.organizationMember.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
    listFeatures(org.id),
  ]);

  // Renaming the organization is the OWNER's alone (the API refuses everybody else, so it is not offered).
  // A2.1: with the switch `controlPanelV2` ON the owner's parts of this page (the name, the box's health, the system tokens, the features) are sections of the one control
  // panel: this page keeps the rest (the integrations' state, the theme review, the profile links) and says where the moved parts went
  const moved = actor.isOwner && (await actorFeatureOn(actor, "controlPanelV2"));
  const canRename = actor.isOwner && !moved;
  // The team manager belongs to whoever holds the capability; everybody else gets the plain directory.
  const manageTeam = actorCan(actor, "users.manage");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-xs text-muted">{t("settings.subtitle")}</p>
      </header>

      {/* organization */}
      <section className="space-y-4 rounded-[14px] bg-surface-1 p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
            <Globe className="size-5" />
          </span>
          <h2 className="text-sm font-semibold">{t("settings.org")}</h2>
        </div>
        {canRename ? <OrgNameForm organizationId={org.id} initialName={org.name} /> : <p className="text-sm">{org.name}</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {t("settings.role")}: <b className="text-fg">{t(ROLE_KEYS[actor.role] ?? "role.member")}</b>
          </span>
          <span aria-hidden>·</span>
          <span>
            {t("settings.createdAt")}: {fmtDMY(org.createdAt, "ar")}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link href={manageTeam ? "/members" : "/teams"} className="inline-flex items-center gap-1.5 text-accent hover:underline">
            <Users className="size-3.5" />
            {t("settings.membersLink", { n: membersCount })}
          </Link>
        </div>
      </section>

      {moved ? (
        <section className="space-y-2 rounded-[14px] bg-surface-1 p-4" data-testid="settings-moved">
          <h2 className="text-sm font-semibold">{t("cpv2.settings.moved_title")}</h2>
          <p className="text-xs text-muted">{t("cpv2.settings.moved_hint")}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={panelHref("company")} className="text-accent hover:underline">
              {t("cpv2.settings.open_company")}
            </Link>
            <Link href={panelHref("features")} className="text-accent hover:underline">
              {t("cpv2.settings.open_features")}
            </Link>
            <Link href={panelHref("integrations")} className="text-accent hover:underline">
              {t("cpv2.settings.open_integrations")}
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* «حال السيرفر»: the owner's read-only look at the box (src/server/services/server-health.ts), above the switches it advises on */}
          {actor.isOwner ? <ServerHealthCard /> : null}

          {/* «توكنات الأنظمة» (W1): the owner's tokens for the systems that call Zaki Workspace */}
          {actor.isOwner ? <SystemTokensCard /> : null}
        </>
      )}

      {/* «معاينة المظاهر» (D1.3): every primitive in every theme, for the owner to review */}
      {actor.isOwner ? <PrimitiveSamples /> : null}

      {/* «الميزات»: the owner's on/off switch for each feature (src/lib/features.ts) */}
      {moved ? null : actor.isOwner ? (
        <section className="space-y-2" aria-labelledby="features-title">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
              <ToggleRight className="size-5" />
            </span>
            <div>
              <h2 id="features-title" className="text-sm font-semibold">
                {t("features.title")}
              </h2>
              <p className="text-xs text-muted">{t("features.subtitle")}</p>
            </div>
          </div>
          <FeatureSwitches initial={features} notReady={embedServer() ? [] : ["semanticSearch"]} />
        </section>
      ) : null}

      {/* integrations */}
      <section className="space-y-3 rounded-[14px] bg-surface-1 p-4">
        <h2 className="text-sm font-semibold">{t("settings.integrations")}</h2>
        <IntegrationBadge ok={Boolean(telegram?.connected)} label={t("nav.telegram")} href="/telegram" />
        <IntegrationBadge ok={Boolean(n8n?.connected)} label={t("nav.n8n")} href="/automation" />
        <IntegrationBadge ok={google.connected} label={t("settings.google_drive")} href="/automation" muted={google.connected ? null : google.configured ? "google.notConnected" : "google.needsEnv"} />
      </section>

      {/* security & personal */}
      <section className="grid gap-3 md:grid-cols-2">
        <Link href="/profile" className="group rounded-[14px] bg-surface-1 p-4 transition-colors hover:bg-surface-2">
          <span className="mb-2 grid size-9 place-items-center rounded-lg bg-info/10 text-info">
            <Lock className="size-5" />
          </span>
          <h3 className="text-sm font-semibold group-hover:text-accent">{t("settings.profileLink")}</h3>
          <p className="mt-1 text-xs text-muted">{t("settings.profileLinkHint")}</p>
        </Link>
        <Link href="/profile" className="group rounded-[14px] bg-surface-1 p-4 transition-colors hover:bg-surface-2">
          <span className="mb-2 grid size-9 place-items-center rounded-lg bg-warn/10 text-warn">
            <KeyRound className="size-5" />
          </span>
          <h3 className="text-sm font-semibold group-hover:text-accent">{t("settings.passwordLink")}</h3>
          <p className="mt-1 text-xs text-muted">{t("settings.passwordLinkHint")}</p>
        </Link>
      </section>
    </div>
  );
}

export const dynamic = "force-dynamic";
