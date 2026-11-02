import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { loadOverview, OwnerBoardError, type BoardQuery } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import { controlPanelAccess, loadPanelHome, loadPanelReports } from "@/server/services/control-panel";
import { BoardCards, DefinitionNote, FilterBar, PeopleTable, TodayStrip, boardHref, paramsOf } from "@/components/owner-board/board";
import { InsightList, KpiGrid, ReportsView, SectionNav, sectionOf, type PanelSection } from "@/components/control-panel/panel";
import { ZakiAiChip, ZakiAiPanel } from "@/components/control-panel/zaki-ai";
import { fmtMoment } from "@/components/owner-board/format";

/**
 * «لوحة التحكم» as a page: what /owner is for the OWNER while the switch «لوحة التحكم» is on. One page, four sections chosen by `?v=`
 * (a link each, no script): «نظرة عامة» (the cards, every sentence, the day's strip, the company's cards), «الناس» (the old people table with
 * its filters, as it was), «التقارير» (the old report merged and extended) and «زاكي أي أي» (is it connected, and how to connect it).
 * Every section is a server read; the access is decided here AND in every service it calls, and reading writes nothing.
 */
export async function ControlPanelPage({ actor, searchParams }: { actor: Actor; searchParams: Record<string, string | string[] | undefined> }) {
  const access = await controlPanelAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { t } = getServerT();
  const section: PanelSection = sectionOf(searchParams["v"]);
  const query = parseBoardQuery(searchParams);
  const hrefOf = (s: PanelSection) => (s === "overview" ? "/owner" : `/owner?v=${s}`);

  const frame = (children: React.ReactNode, notice?: string) => (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6" data-section={section}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("cp.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("cp.subtitle")}</p>
        </div>
        <ZakiAiChip />
      </header>
      <SectionNav t={t} current={section} hrefOf={hrefOf} />
      {notice ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
          {notice}
        </p>
      ) : null}
      {children}
    </div>
  );

  if (section === "reports") {
    const reports = await loadPanelReports(access, { space: query.space ?? null }).catch((err: unknown) => {
      if (err instanceof NotFoundError) notFound();
      throw err;
    });
    return frame(<ReportsView t={t} r={reports} />);
  }

  if (section === "ai") return frame(<ZakiAiPanel />);

  if (section === "people") {
    // a refused range (wrong days, more than 92 of them) shows its reason and falls back to the default window
    let notice: string | undefined;
    const read = async (q: BoardQuery) => loadOverview(access, q);
    const o = await read(query).catch(async (err: unknown) => {
      if (err instanceof OwnerBoardError) {
        notice = `${t(err.issues[0]?.message ?? "ownerboard.range_invalid")} ${t("ownerboard.notice_range")}`;
        return read({ ...query, preset: null, from: null, to: null });
      }
      if (err instanceof NotFoundError) notFound();
      throw err;
    });
    const carry = { ...paramsOf(o), person: o.filters.person, v: "people" };
    const personHref = (id: string) => boardHref(`/owner/people/${id}`, paramsOf(o));
    const sortHref = (sort: string, dir: string) => boardHref("/owner", { ...carry, sort, dir });
    return frame(
      <>
        <header>
          <h2 className="text-base font-semibold">{t("cp.people.title")}</h2>
          <p className="text-xs text-muted">{t("cp.people.hint")}</p>
        </header>
        <DefinitionNote t={t} />
        <FilterBar
          t={t}
          action="/owner"
          hidden={{ v: "people" }}
          resetHref="/owner?v=people"
          o={o}
          people={o.people}
          csvHref={boardHref("/api/owner-board/csv", { ...carry, sort: o.filters.sort, dir: o.filters.dir })}
        />
        <PeopleTable t={t} o={o} personHref={personHref} sortHref={sortHref} />
      </>,
      notice,
    );
  }

  // «نظرة عامة»: everything the home panel says, all of it, and the company's cards of the board's window
  const [home, overview] = await Promise.all([loadPanelHome(access), loadOverview(access, { preset: "7", sort: "completed" })]);
  const personHref = (id: string) => `/owner/people/${id}`;
  return frame(
    <>
      <KpiGrid t={t} kpis={home.kpis} />
      <InsightList t={t} insights={home.insights} />
      <TodayStrip t={t} today={home.todayStrip} timeZone={home.timeZone} personHref={personHref} />
      {overview.cards ? <BoardCards t={t} cards={overview.cards} title={t("ownerboard.cards.title")} /> : null}
      <p className="text-xs text-muted">{t("cp.as_of", { when: fmtMoment(home.asOf, home.timeZone) })}</p>
    </>,
  );
}
