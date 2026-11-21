import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import ApprovalsPage from "@/app/(app)/approvals/page";
import { RequestsView } from "@/components/work/requests/requests-view";
import { requestTabOf } from "@/components/work/requests/types";
import { isFeatureOn } from "@/server/services/features";
import { requestsScopeHere, workRequestsOf } from "@/server/services/work-requests";

/**
 * «الطلبات» — /requests (W1.4): one inbox of everything that waits for a decision, two tabs («بانتظاري» / «طلباتي»), each row acting in place
 * through the doors that already exist. The approvals pages (/approvals, a request's page, the forms) stay pages of their own: this one links into them.
 *
 * A guest (external partner) is refused: the tab is not offered to them (`offeredToGuests`), so the page does not serve them either. While the owner's
 * switch `workRequests` is OFF (the default) this address serves today's approvals page unchanged, so the new map's tab never dead-ends and nothing
 * moves until the owner decides.
 */
export default async function RequestsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "requests")) return <GuestNotice />;
  if (!(await isFeatureOn(actor.orgId, "workRequests"))) return ApprovalsPage({ searchParams });
  const raw = searchParams?.["tab"];
  // B4: each space is its own account: the space the person is in (inside «الشركة»: all of them, grouped by space with «انتقل»)
  const view = await workRequestsOf(actor, requestTabOf(typeof raw === "string" ? raw : undefined), await requestsScopeHere(actor));
  return <RequestsView initial={view} />;
}

export const dynamic = "force-dynamic";
