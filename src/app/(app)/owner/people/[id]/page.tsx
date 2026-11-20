import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { boardAccess } from "@/server/policy/board";
import { actorFeatureOn } from "@/server/services/features";
import { myBoardAccess } from "@/server/services/control-panel";
import { loadPerson, OwnerBoardError } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import { FilterBar, PersonPage, boardHref, paramsOf } from "@/components/owner-board/board";

/**
 * «لوحة المالك» — one person's page: their day-by-day table, tasks (titles), steps, message COUNTS, open and overdue tasks, spaces.
 * Your own page for whoever holds `board.self`; somebody else's only inside your reach (the owner: everybody; `board.team`: the
 * people of the spaces you manage). Outside it, and for a guest, it is «not found» (never «forbidden»).
 */
export default async function OwnerBoardPersonPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  // A2.1 (D-A6): with the switch `controlPanelV2` ON a person's OWN page is «لوحتي», independent of the owner's board switch: when the board is off for them (the switch, or
  // no `board.team`) their own box `board.self` still opens their own page, and nobody else's
  const access = await boardAccess(actor).catch(async (err: unknown) => {
    if (err instanceof NotFoundError && params.id === actor.userId && (await actorFeatureOn(actor, "controlPanelV2"))) {
      try {
        return myBoardAccess(actor);
      } catch (own) {
        return miss(own);
      }
    }
    return miss(err);
  });
  const { t } = getServerT();
  const query = parseBoardQuery(searchParams ?? {});
  let notice: string | undefined;
  let view;
  try {
    view = await loadPerson(access, params.id, query);
  } catch (err) {
    if (!(err instanceof OwnerBoardError)) miss(err);
    notice = `${t((err as OwnerBoardError).issues[0]?.message ?? "ownerboard.range_invalid")} ${t("ownerboard.notice_range")}`;
    view = await loadPerson(access, params.id, { ...query, preset: null, from: null, to: null }).catch(miss);
  }
  const carry = paramsOf({ window: view.window, filters: { space: query.space ?? null } });
  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{t(`ownerboard.title.${access.mode}`)}</h1>
        {access.mode !== "self" ? (
          <Link href={boardHref("/owner", carry)} className="text-sm text-info underline">
            {t("ownerboard.back")}
          </Link>
        ) : null}
      </header>
      {notice ? <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">{notice}</p> : null}
      <FilterBar t={t} action={`/owner/people/${params.id}`} o={{ window: view.window, filters: { space: null, person: null, sort: "completed", dir: "desc" }, spaces: [] }} />
      <PersonPage t={t} v={view} taskHref={(id) => `/tasks/${id}`} />
    </div>
  );
}

export const dynamic = "force-dynamic";
