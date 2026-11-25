import { redirect } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { withSavedFilters } from "@/lib/work/saved-filters";
import { LegacyMyWorkPage } from "@/app/(app)/my-work/legacy-page";
import { MyTasksView } from "@/components/work/my-tasks/my-tasks-view";
import { actorCanWork } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";
import { workScreenFor } from "@/server/services/my-work";
import { managedSpacesOf } from "@/server/services/stale-tasks";
import { myTasksApiQuery, myTasksHref, parseMyTasksParams } from "@/lib/work/my-tasks";

/**
 * «مهامي» — /my-work. With the owner's switch `workMyTasks` ON (W1.1) this is the ONE screen of a person's tasks: three views (قائمة · لوحة · تقويم), three
 * scopes (أنا: assigned to me or shared with me across ALL my spaces · المساحة: the space I am in · مشروع), the chips اليوم · متأخرة · هالأسبوع · بدون موعد ·
 * مكتملة · أنشأتها, a sort and a grouping; the task opens in a side panel (`?task=<id>`) and `/tasks/[id]` stays the full page. `/list` and `/calendar` send
 * here (`?view=list|calendar&scope=space`), and the six old inner tabs are chips (`?tab=today` still opens «اليوم»). Every read goes through the task-visibility
 * rule: a task hidden from the person is not listed, not counted and not found by the search.
 *
 * With the switch OFF (the default) this address serves today's page unchanged (`legacy-page.tsx`), so nothing moves until the owner decides.
 *
 * W1.9: the bar carries a link «مهام قديمة» to /my-work/stale, only for somebody who manages a space, and only while `workStaleSweep` is on (the page behind the link decides again).
 */
export default async function MyWorkPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  // the tasks row of the person's grid (a guest works in their shared spaces by the space's rules)
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  if (!(await isFeatureOn(actor.orgId, "workMyTasks"))) return LegacyMyWorkPage({ searchParams: { tab: firstOf(searchParams?.["tab"]) } });

  // a plain visit opens with the filters this person keeps; an address that asks for something itself is left as it is
  const kept = withSavedFilters(searchParams ?? {}, (await db.user.findUnique({ where: { id: actor.userId }, select: { taskFilters: true } }))?.taskFilters);
  if (kept) redirect(myTasksHref(kept));

  const requested = parseMyTasksParams(searchParams ?? {});
  const now = new Date();
  const [initial, staleHref] = await Promise.all([workScreenFor(actor, requested, now), staleLinkFor(actor)]);
  const query = myTasksApiQuery(requested);
  // `key`: an address the screen did not make itself (the menu's link, a pasted one) is a NEW screen, not a stale one
  return <MyTasksView key={query} requested={requested} initial={initial} initialQuery={query} initialAt={now.getTime()} staleHref={staleHref} />;
}

/** The review list's address for a person who may open it (a guest never; nobody while its switch is off; somebody who manages no space is told on the page itself, so no link). */
async function staleLinkFor(actor: Awaited<ReturnType<typeof pageActor>>["actor"]): Promise<string | null> {
  if (actor.isExternal || !(await isFeatureOn(actor.orgId, "workStaleSweep"))) return null;
  return (await managedSpacesOf(actor)).length > 0 ? "/my-work/stale" : null;
}

const firstOf = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export const dynamic = "force-dynamic";
