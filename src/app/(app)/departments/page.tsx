import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { sectionMay } from "@/lib/section-may";
import { getServerT } from "@/lib/i18n/server";
import { DepartmentsView } from "@/components/departments-view";

/**
 * Company departments — the company's pools; every org member with the `directory.view` switch
 * reads, OWNER/ADMIN manage. A guest gets only a notice: the page is the staff directory and the
 * API refuses guests (403), so the view is not even rendered for them. Someone whose
 * `directory.view` was switched off gets the "not enabled for you" notice for the same reason.
 */
export default async function DepartmentsPage() {
  const { t } = await getServerT();
  const { user, actor } = await pageActor();

  if (actor.isExternal) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
        {t("guest.no_access")}
      </div>
    );
  }
  // «محصور بمساحة»: the departments are the whole company's, and the API refuses such an account (403)
  if (!actorCan(actor, "directory.view") || actor.spaceOnly) return <SectionOffNotice />;

  return (
    <DepartmentsView
      me={{ role: actor.role, id: user.id, tickets: sectionMay(actor.caps, "tickets"), campaigns: sectionMay(actor.caps, "campaigns") }}
    />
  );
}

export const dynamic = "force-dynamic";
