import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { spaceSettingsFor } from "@/server/services/space-settings";
import { parseSettingsTab } from "@/components/space-settings/tabs";
import { SettingsTabs } from "@/components/space-settings/settings-tabs";
import { GeneralTab } from "@/components/space-settings/general-tab";
import { WorkspaceMembersPanel } from "@/components/space-settings/people-panel";
import { WorkspaceTeamsPanel } from "@/components/space-settings/teams-panel";
import { ChatTab } from "@/components/space-settings/chat-tab";
import { WorkTab } from "@/components/space-settings/work-tab";
import { DangerTab } from "@/components/space-settings/danger-tab";

export const metadata = { title: getServerT().t("spset.title") };

/**
 * «إعدادات المساحة» — ONE settings page per space (A2.2, switch `controlPanelV2`): the dialogs that used to be scattered over the projects page and «الإدارة» are its
 * tabs («عام · الناس · المقاطع · الدردشة · الشغل · خطر»). Which tabs a person sees is `settingsTabsFor`; every control inside decides again on the server.
 *
 * «Not found», never «forbidden», for: the switch off, a space the person cannot open (another company's, one they were never put in, an archived one, one that does
 * not exist), and an external partner. The OWNER opens every space of the company without a row. A plain member of the space reads «الناس» and «المقاطع»
 * only; the manager (`isSpaceManager`, unchanged: D-A2 is open) gets the rest; «خطر» only for whoever can archive (the OWNER, the ADMINs) or delete (the OWNER).
 * What the page reads is `spaceSettingsFor` — the same answer the phone's door gives (GET /api/spaces/[id]/settings).
 */
export default async function SpaceSettingsPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  const { actor } = await pageActor();
  const s = await spaceSettingsFor(actor, params.id).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const tab = parseSettingsTab(searchParams?.["tab"], s.tabs);
  if (!tab) notFound();

  let panel: React.ReactNode;
  if (tab === "general") {
    panel = <GeneralTab spaceId={s.id} name={s.name} description={s.description} emoji={s.emoji} layout={s.layout} department={s.department} />;
  } else if (tab === "people") {
    panel = (
      <div className="space-y-2">
        <p className="text-xs leading-5 text-fg-muted">{t("spset.people.hint")}</p>
        <WorkspaceMembersPanel workspaceId={s.id} />
      </div>
    );
  } else if (tab === "teams") {
    panel = <WorkspaceTeamsPanel workspaceId={s.id} />;
  } else if (tab === "chat") {
    panel = <ChatTab spaceId={s.id} starters={s.starters} />;
  } else if (tab === "work") {
    panel = <WorkTab spaceId={s.id} timeZone={s.work.timeZone} columns={s.work.columns} stagesOn={s.work.stagesOn} parts={s.work.parts} />;
  } else {
    panel = <DangerTab spaceId={s.id} name={s.name} canArchive={s.facts.canArchive} canDelete={s.facts.canDelete} department={s.department} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6" data-space-settings>
      <header>
        <h1 className="text-xl font-semibold text-fg">
          {t("spset.title")}
          <span className="text-sm font-normal text-fg-muted">
            {" · "}
            {s.emoji ? <span aria-hidden="true">{s.emoji} </span> : null}
            <bdi>{s.name}</bdi>
          </span>
        </h1>
        <p className="text-sm text-fg-muted">{t("spset.hint")}</p>
      </header>
      <SettingsTabs spaceId={s.id} tabs={s.tabs} current={tab} />
      <div data-space-settings-panel={tab}>{panel}</div>
    </div>
  );
}

export const dynamic = "force-dynamic";
