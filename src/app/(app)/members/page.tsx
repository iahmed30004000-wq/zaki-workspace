import { redirect } from "next/navigation";
import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { db } from "@/server/db";
import { actorCan, type Actor } from "@/server/policy/actor";
import { RANK } from "@/server/policy/rank";
import { getServerT } from "@/lib/i18n/server";
import { OrgMembersView } from "@/components/org-members-view";
import { StaffDirectory, type DirectoryPerson } from "@/components/members/staff-directory";

/**
 * The people an ordinary member may look at: ACTIVE ones only, with job title, rank and e-mail (the
 * caller holds `directory.view`, or they would not be here). Ordered by rank, the owner first.
 */
async function loadDirectory(actor: Actor): Promise<DirectoryPerson[]> {
  const rows = await db.organizationMember.findMany({
    where: { organizationId: actor.orgId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { role: true, user: { select: { id: true, name: true, jobTitle: true, email: true, avatarUrl: true } } },
  });
  return rows
    .map((r) => ({ id: r.user.id, name: r.user.name, jobTitle: r.user.jobTitle, role: r.role, email: r.user.email, avatarUrl: r.user.avatarUrl }))
    .sort((a, b) => RANK[b.role] - RANK[a.role]);
}

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

  const people = await loadDirectory(actor);
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
