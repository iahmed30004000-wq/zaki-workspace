import { redirect } from "next/navigation";
import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { actorCan } from "@/server/policy/actor";
import { staffDirectory } from "@/server/chat/directory";
import { getServerT } from "@/lib/i18n/server";
import { OrgMembersView } from "@/components/org-members-view";
import { StaffDirectory } from "@/components/members/staff-directory";

/**
 * الأعضاء والصلاحيات. The team manager for whoever holds the capability `users.manage` (the owner
 * and the admins by default, and anybody the owner switches it on for). For everybody else the page
 * is the staff directory, and the directory is a switch like on /teams: with `directory.view` a
 * read-only list of the ACTIVE people; without it the same "not enabled for you" notice, and no name
 * is read at all. An external partner gets the honest notice they always had.
 */
export default async function MembersPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  const { actor } = await pageActor();

  if (actorCan(actor, "users.manage")) {
    // A2.1: with the switch `controlPanelV2` ON the people screen is the section «الحسابات والصلاحيات» of the one panel (the same view, moved)
    const inPanel = await panelRedirectFor(actor, "/members", carriedQuery(searchParams));
    if (inPanel) redirect(inPanel);
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
        <OrgMembersView orgId={actor.orgId} actorId={actor.userId} actorRole={actor.role} actorCaps={[...actor.caps]} />
      </div>
    );
  }

  if (actor.isExternal) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-border bg-surface-1 p-8 text-center">
          <h1 className="text-base font-semibold text-fg">{t("guest.no_access")}</h1>
          {/* the honest detail stays: a guest is refused this section, not merely read-only */}
          <p className="mt-2 text-sm text-fg-muted">{t("orgm.members_only")}</p>
        </div>
      </div>
    );
  }

  if (!actorCan(actor, "directory.view")) return <SectionOffNotice />;

  // the ACTIVE people, the owner first; `verified` rides along for a non-guest viewer while the switch is on (src/server/chat/directory.ts)
  const people = await staffDirectory(actor.orgId, actor.role, actor.userId);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("teams.title")}</h1>
        <p className="mt-1 text-xs text-fg-muted">{t("members.dir_subtitle")}</p>
      </header>
      <StaffDirectory people={people} t={t} linkProfiles />
    </div>
  );
}

export const dynamic = "force-dynamic";
