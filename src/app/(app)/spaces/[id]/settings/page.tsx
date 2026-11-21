import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { db } from "@/server/db";
import { actorFeatureOn, isFeatureOn } from "@/server/services/features";
import { spacesOf } from "@/server/services/current-space";
import { mayOverview } from "@/server/services/spaces-overview";
import { orgTimeZone } from "@/server/services/org-day";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import { SPACE_STARTER_TOPICS } from "@/server/chat/space-topics";
import { isSpaceManager } from "@/server/workspace-role";
import { parseSettingsTab, settingsTabsFor, type SettingsFacts } from "@/components/space-settings/tabs";
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
 */
export default async function SpaceSettingsPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (!(await actorFeatureOn(actor, "controlPanelV2"))) notFound();
  if (actor.isExternal) notFound();

  const entry = (await spacesOf(actor)).find((space) => space.id === params.id);
  if (!entry) notFound();

  const facts: SettingsFacts = {
    external: false,
    manager: isSpaceManager(actor.role, entry.role),
    canArchive: mayOverview(actor) && entry.kind !== "HQ",
    canDelete: actor.role === "OWNER" && entry.kind !== "HQ",
  };
  const tabs = settingsTabsFor(facts);
  const tab = parseSettingsTab(searchParams?.["tab"], tabs);
  if (!tab) notFound();

  const info = await db.workspace.findFirst({
    where: { id: entry.id, organizationId: actor.orgId },
    select: { name: true, description: true, emoji: true },
  });
  if (!info) notFound();

  let panel: React.ReactNode;
  if (tab === "general") {
    panel = <GeneralTab spaceId={entry.id} name={info.name} description={info.description} emoji={info.emoji} layout={entry.layout} department={entry.kind === "DEPARTMENT"} />;
  } else if (tab === "people") {
    panel = (
      <div className="space-y-2">
        <p className="text-xs leading-5 text-fg-muted">{t("spset.people.hint")}</p>
        <WorkspaceMembersPanel workspaceId={entry.id} />
      </div>
    );
  } else if (tab === "teams") {
    panel = <WorkspaceTeamsPanel workspaceId={entry.id} />;
  } else if (tab === "chat") {
    panel = <ChatTab spaceId={entry.id} starters={SPACE_STARTER_TOPICS.map((topic) => ({ title: topic.title, emoji: topic.emoji, postingPolicy: topic.postingPolicy }))} />;
  } else if (tab === "work") {
    const [timeZone, stagesOn, checkins, customFields, approvals] = await Promise.all([
      orgTimeZone(actor.orgId),
      isFeatureOn(actor.orgId, "workStages"),
      isFeatureOn(actor.orgId, "checkins"),
      isFeatureOn(actor.orgId, "customFields"),
      isFeatureOn(actor.orgId, "approvals"),
    ]);
    panel = (
      <WorkTab
        spaceId={entry.id}
        timeZone={timeZone}
        columns={DEFAULT_BOARD_COLUMNS.map((column) => ({ name: column.name, stage: column.stage }))}
        stagesOn={stagesOn}
        parts={{ checkins, customFields, approvals }}
      />
    );
  } else {
    panel = <DangerTab spaceId={entry.id} name={info.name} canArchive={facts.canArchive} canDelete={facts.canDelete} department={entry.kind === "DEPARTMENT"} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6" data-space-settings>
      <header>
        <h1 className="text-xl font-semibold text-fg">
          {t("spset.title")}
          <span className="text-sm font-normal text-fg-muted">
            {" · "}
            {info.emoji ? <span aria-hidden="true">{info.emoji} </span> : null}
            <bdi>{info.name}</bdi>
          </span>
        </h1>
        <p className="text-sm text-fg-muted">{t("spset.hint")}</p>
      </header>
      <SettingsTabs spaceId={entry.id} tabs={tabs} current={tab} />
      <div data-space-settings-panel={tab}>{panel}</div>
    </div>
  );
}

export const dynamic = "force-dynamic";
