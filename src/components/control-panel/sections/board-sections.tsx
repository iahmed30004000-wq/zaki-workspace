import { notFound } from "next/navigation";
import type { ServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { loadOverview, OwnerBoardError, type BoardQuery } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import { loadPanelHome, panelScopeOf, companyPanelAccess, type PanelAccess } from "@/server/services/control-panel";
import { BoardCards, DefinitionNote, FilterBar, PeopleTable, TodayStrip, boardHref, paramsOf } from "@/components/owner-board/board";
import { InsightList, KpiGrid } from "@/components/control-panel/panel";
import { ScopeChip, SectionHeader, scopeText } from "@/components/control-panel/frame";
import { fmtMoment } from "@/components/owner-board/format";

/**
 * «نظرة عامة» and «الناس» — the two sections that read the owner's board (`access.board`: the whole company for the owner rank holding `board.team`, the spaces and teams
 * they manage for a holder of `board.team`; a person with neither has no such section, their own page is «لوحتي»). MOVED, not rebuilt: «نظرة عامة» is the first panel's
 * home (the cards, every sentence with its formula, the day's strip, the company's cards) and «الناس» is the board's people table with its filters. Every figure carries its
 * scope («كل الشركة» / «مساحة: X»): the numbers' own rule («فريقي», A2.3) is not changed here, the chip only says what the service counted. Reading writes nothing.
 */
export interface SectionCtx {
  actor: Actor;
  userId: string;
  access: PanelAccess;
  searchParams: Record<string, string | string[] | undefined>;
  t: ServerT;
  /** S3.2: the panel is drawn with ONE navigation (`settingsOneDoor`): a section wears the navigation's name. Left out: today's names. */
  oneDoor?: boolean;
}

const miss = (err: unknown): never => {
  if (err instanceof NotFoundError) notFound();
  throw err;
};

export async function OverviewSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, access, t } = ctx;
  const board = access.board;
  if (!board) return notFound();
  const scope = await panelScopeOf(board);
  const label = scopeText(t, scope);
  const personHref = (id: string) => `/owner/people/${id}`;
  // the first panel's numbers (KPIs and sentences) belong to the company-wide owner while its own switch is on; otherwise the board's «اليوم» and its cards
  const full = board.mode === "owner" ? await companyPanelAccess(actor) : null;
  const [home, overview] = await Promise.all([full ? loadPanelHome(full) : Promise.resolve(null), loadOverview(board, { preset: "7", sort: "completed" }).catch(miss)]);
  return (
    <div className="space-y-5" data-testid="cp-overview">
      <SectionHeader t={t} section="overview" hint={t("cpv2.overview.hint")} scope={scope} />
      {home ? <KpiGrid t={t} kpis={home.kpis} scope={label} /> : null}
      {home ? <InsightList t={t} insights={home.insights} /> : null}
      {home ? <TodayStrip t={t} today={home.todayStrip} timeZone={home.timeZone} personHref={personHref} /> : overview.today ? <TodayStrip t={t} today={overview.today} timeZone={overview.window.timeZone} personHref={personHref} /> : null}
      {overview.cards ? <BoardCards t={t} cards={overview.cards} title={t("ownerboard.cards.title")} /> : null}
      {home ? <p className="text-xs text-muted">{t("cp.as_of", { when: fmtMoment(home.asOf, home.timeZone) })}</p> : null}
    </div>
  );
}

/**
 * `part` (S3.2, the switch `settingsOneDoor`): the table is the part «النشاط» of the ONE section «الناس», which draws its own title and parts; here only the scope chip stays, and the
 * filters, the sort and the CSV link carry the part so they come back to it. Left out, the section is drawn as it was.
 */
export async function PeopleSection({ ctx, part }: { ctx: SectionCtx; part?: string }) {
  const { access, searchParams, t } = ctx;
  const board = access.board;
  if (!board) return notFound();
  const query = parseBoardQuery(searchParams);
  let notice: string | undefined;
  // a refused range (wrong days, more than 92 of them) shows its reason and falls back to the default window
  const read = async (q: BoardQuery) => loadOverview(board, q);
  const o = await read(query).catch(async (err: unknown) => {
    if (err instanceof OwnerBoardError) {
      notice = `${t(err.issues[0]?.message ?? "ownerboard.range_invalid")} ${t("ownerboard.notice_range")}`;
      return read({ ...query, preset: null, from: null, to: null });
    }
    return miss(err);
  });
  const scope = await panelScopeOf(board);
  const where: Record<string, string> = part ? { s: "people", part } : { s: "people" };
  const carry = { ...paramsOf(o), person: o.filters.person, ...where };
  const personHref = (id: string) => boardHref(`/owner/people/${id}`, paramsOf(o));
  const sortHref = (sort: string, dir: string) => boardHref("/owner", { ...carry, sort, dir });
  return (
    <div className="space-y-4" data-testid="cp-people">
      {part ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-xs leading-5 text-fg-muted">{t("cp.people.hint")}</p>
          <ScopeChip t={t} scope={scope} />
        </div>
      ) : (
        <SectionHeader t={t} section="people" hint={t("cp.people.hint")} scope={scope} />
      )}
      {notice ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
          {notice}
        </p>
      ) : null}
      <DefinitionNote t={t} />
      <FilterBar t={t} action="/owner" hidden={where} resetHref={part ? `/owner?s=people&part=${part}` : "/owner?s=people"} o={o} people={o.people} csvHref={boardHref("/api/owner-board/csv", { ...carry, sort: o.filters.sort, dir: o.filters.dir })} />
      <PeopleTable t={t} o={o} personHref={personHref} sortHref={sortHref} title={part ? t("cpv2.dd.people.activity_title") : undefined} />
    </div>
  );
}
