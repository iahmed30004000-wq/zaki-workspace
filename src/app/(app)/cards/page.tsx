import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { currentSpace } from "@/server/services/current-space";
import { listCards } from "@/server/services/cards";
import { actorCan } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { getToday } from "@/server/services/today";
import { cardsIntentOf } from "@/lib/nav/new-actions";
import { TodayQuickAdd } from "@/components/today/quick-add";
import { EmptyState } from "@/components/ui/card";
import { CardsView } from "@/components/cards/cards-view";

/** The browser tab says «اللوحات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("cards.title") };

/**
 * «اللوحات» — the cards of the space the person is in. It opens in every space (a space of the CARDS type lives here;
 * a general space simply has them too). Who may read and write is decided by the service from the session, and decided
 * again on every request the screen makes; the page only passes down what it was told.
 *
 * W1.8 — «جديد → مهمة» in a space of cards keeps its intent: «اليوم» is not drawn here and «/» sends the person to this page (a query would be lost on the
 * way), so `/cards?new=task` opens the SAME task sheet Today uses (`TodayQuickAdd` reads `?new=task`), beside the cards. It is built from the person's own
 * quick-add facts in THIS space (`getToday`), and only for staff who may add a task somewhere (an external partner gets the plain page).
 */
export default async function CardsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  const space = await currentSpace(actor);
  if (!space) return <EmptyState title={t("cards.no_space")} />;
  const list = await listCards(actor, space.id);
  // a manufacturing space also has «مخزون التصنيع» (a tab, not a place of the menu): drawn only for who may open it
  const stockTab = space.layout === "MANUFACTURING" && !actor.isExternal && actorCan(actor, "manufacturing.view") && (await actorFeatureOn(actor, "mfgLedger"));
  const view = <CardsView spaceId={space.id} spaceName={space.name} userId={user.id} initial={list.cards} canWrite={list.canWrite} owner={list.owner} layout={space.layout} stockTab={stockTab} />;
  if (cardsIntentOf(searchParams) !== "task" || actor.isExternal) return view;
  const today = await getToday(actor, { spaceId: space.id });
  if (!today.quickAdd) return view;
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pt-2 md:px-6">
        <TodayQuickAdd quickAdd={today.quickAdd} timeZone={today.timeZone} />
      </div>
      {view}
    </>
  );
}

export const dynamic = "force-dynamic";
