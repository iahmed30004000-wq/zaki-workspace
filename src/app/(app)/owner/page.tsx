import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { actorFeatureOn } from "@/server/services/features";
import { boardAccess } from "@/server/policy/board";
import { ControlPanelPage } from "./control-panel-view";
import { loadOverview, loadPerson, OwnerBoardError, type BoardQuery } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import { BoardCards, DefinitionNote, FilterBar, PeopleTable, PersonPage, TodayStrip, boardHref, paramsOf } from "@/components/owner-board/board";

/**
 * «لوحة المالك» — /owner. One page, three readers (src/server/policy/board.ts decides which):
 *   the owner and his partners  everybody: the company's cards, «اليوم», the people table;
 *   a `board.team` holder       the people of the spaces they manage and the teams they lead: «اليوم» and the table, no totals;
 *   a `board.self` holder       their own page, nothing else.
 * Anybody else (a guest, a person with neither switch, the feature switched off) gets «not found», and the menu never offers it.
 * Reading writes nothing: no audit row, no notification, no «seen».
 */
export default async function OwnerBoardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const access = await boardAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  // «لوحة التحكم»: for the owner, /owner is the control panel while its switch is on (off: this page exactly as it was)
  if (access.mode === "owner" && (await actorFeatureOn(actor, "controlPanel"))) return ControlPanelPage({ actor, searchParams: searchParams ?? {} });
  const { t } = getServerT();
  const query = parseBoardQuery(searchParams ?? {});
  const title = t(`ownerboard.title.${access.mode}`);
  const subtitle = t(`ownerboard.subtitle.${access.mode}`);
  // «ملفي» (الأداء والتطوير): a plain employee has no tab for it, so their own board page links to their file
  const fileLink = (await actorFeatureOn(actor, "teamDevelopment")) && !actor.isExternal;
  const frame = (children: React.ReactNode, notice?: string) => (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </header>
      {fileLink ? (
        <Link href="/development" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2 md:min-h-9" data-my-file-link>
          {t("teamdev.my_file_link")}
        </Link>
      ) : null}
      {notice ? <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">{notice}</p> : null}
      {children}
    </div>
  );

  // a refused range (wrong days, more than 92 of them) shows its reason and falls back to the default window
  const safely = async <T,>(read: (q: BoardQuery) => Promise<T>): Promise<{ value: T; notice?: string }> => {
    try {
      return { value: await read(query) };
    } catch (err) {
      if (err instanceof OwnerBoardError) {
        const reason = err.issues[0]?.message ?? "ownerboard.range_invalid";
        return { value: await read({ ...query, preset: null, from: null, to: null }), notice: `${t(reason)} ${t("ownerboard.notice_range")}` };
      }
      throw err;
    }
  };
  const notFoundOnMiss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };

  if (access.mode === "self") {
    const { value: view, notice } = await safely((q) => loadPerson(access, actor.userId, q)).catch(notFoundOnMiss);
    return frame(
      <>
        <DefinitionNote t={t} />
        <FilterBar t={t} action="/owner" o={{ window: view.window, filters: { space: null, person: null, sort: "completed", dir: "desc" }, spaces: [] }} />
        <PersonPage t={t} v={view} taskHref={(id) => `/tasks/${id}`} />
      </>,
      notice,
    );
  }

  const { value: o, notice } = await safely((q) => loadOverview(access, q)).catch(notFoundOnMiss);
  const carry = { ...paramsOf(o), person: o.filters.person };
  const personHref = (id: string) => boardHref(`/owner/people/${id}`, paramsOf(o));
  const sortHref = (sort: string, dir: string) => boardHref("/owner", { ...carry, sort, dir });
  return frame(
    <>
      <DefinitionNote t={t} />
      <FilterBar t={t} action="/owner" o={o} people={o.people} csvHref={boardHref("/api/owner-board/csv", { ...carry, sort: o.filters.sort, dir: o.filters.dir })} />
      {o.today ? <TodayStrip t={t} today={o.today} timeZone={o.window.timeZone} personHref={personHref} /> : null}
      {o.cards ? <BoardCards t={t} cards={o.cards} title={t(o.filters.person ? "ownerboard.cards.person_title" : "ownerboard.cards.title")} /> : null}
      <PeopleTable t={t} o={o} personHref={personHref} sortHref={sortHref} />
    </>,
    notice,
  );
}

export const dynamic = "force-dynamic";
