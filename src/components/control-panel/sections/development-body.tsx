import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pickerPeriods } from "@/lib/team-score";
import { dayKeyOf } from "@/lib/owner-board";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { orgTimeZone } from "@/server/services/org-day";
import { loadDevelopmentHome } from "@/server/services/team-people";
import { getWeights, loadScoreTable } from "@/server/services/team-score";
import { loadStructure } from "@/server/services/team-lines";
import { PersonFile, tabOf } from "@/components/team-development/person-file";
import { PeriodPicker, ScoreFormula, ScoreTableView } from "@/components/team-development/score-panel";
import { StructureTree } from "@/components/structure/structure-tree";

/**
 * «الأداء والتطوير» and «الهيكل» — the bodies of the pages /development and /structure, MOVED (A2.1) so the section «الهيكل والتطوير» of the control panel draws the very
 * same screens: nothing was rebuilt, and reading writes nothing. `where` says how the screen links to itself: the old pages keep their own addresses, inside the panel
 * the same links and the period form point at the section (`/owner?s=structure&part=…`). The access of both is the services' (`devAccess` and the rules of «الهيكل»).
 */
export interface DevelopmentWhere {
  /** The GET form's action and the hidden fields it must carry (the section and part inside the panel). */
  action: string;
  hidden: Record<string, string>;
  /** The address of this screen with a query (the period, the sort). */
  hrefOf: (query: Record<string, string>) => string;
  /** Where «الهيكل» is (the link of the header), `/structure` on the old pages. */
  structureHref: string;
  /** Where the people's page of «الأداء والتطوير» is (the structure page's link back). */
  developmentHref: string;
  heading: "h1" | "h2";
}

export const OLD_DEVELOPMENT: DevelopmentWhere = {
  action: "/development",
  hidden: {},
  hrefOf: (query) => `/development?${new URLSearchParams(query).toString()}`,
  structureHref: "/structure",
  developmentHref: "/development",
  heading: "h1",
};

const pill = "inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 hover:bg-surface-2 md:min-h-9";
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function DevelopmentBody({ actor, searchParams, where = OLD_DEVELOPMENT }: { actor: Actor; searchParams?: Record<string, string | string[] | undefined>; where?: DevelopmentWhere }) {
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const home = await loadDevelopmentHome(actor).catch(miss);
  // a person who reads nobody but themselves lands on their own file
  if (home.mode === "self") return <PersonFile actor={actor} userId={home.viewerId} tab={tabOf(searchParams?.["tab"])} basePath={where.action} query={searchParams} />;

  const { t } = getServerT();
  const Title = where.heading;
  const sort = first(searchParams?.["sort"]) === "score" ? "score" : "name";
  const table = await loadScoreTable(actor, { period: first(searchParams?.["period"]), sort }).catch(miss);
  const weights = await getWeights(actor);
  const options = pickerPeriods(dayKeyOf(new Date(), await orgTimeZone(actor.orgId)));
  const href = (extra: Record<string, string>) => where.hrefOf({ period: table.period.key, ...extra });
  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Title className="text-xl font-semibold tracking-tight">{t("teamdev.title")}</Title>
          <p className="mt-1 text-sm text-fg-muted">{t(home.mode === "owner" ? "teamdev.subtitle_owner" : "teamdev.subtitle_supervisor")}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("teamdev.title")}>
          <Link href={`/development/people/${home.viewerId}`} className={pill}>
            {t("nav.tab.myFile")}
          </Link>
          <Link href="/development/skills" className={pill}>
            {t("teamdev.skills.page")}
          </Link>
          <Link href={where.structureHref} className={pill}>
            {t("teamdev.structure.title")}
          </Link>
          {home.mode === "owner" ? (
            <Link href="/development/settings" className={pill} data-settings-link>
              {t("teamdev.settings.title")}
            </Link>
          ) : null}
        </nav>
      </header>

      <PeriodPicker t={t} action={where.action} options={options} selected={table.period.key} extra={{ ...where.hidden, ...(sort === "score" ? { sort } : {}) }} />
      {table.period.partial ? <p className="text-xs text-warn">⚠️ {t("teamdev.score.partial")}</p> : null}

      {table.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.people.empty")}</p>
      ) : (
        <ScoreTableView
          table={table}
          t={t}
          kind={table.period.kind}
          sortHref={(s) => href(s === "score" ? { sort: "score" } : {})}
          csvHref={`/api/team-development/people/csv?${new URLSearchParams({ period: table.period.key, sort }).toString()}`}
          personHref={(id) => `/development/people/${id}?tab=score&period=${table.period.key}`}
        />
      )}
      <ScoreFormula t={t} weights={weights} />
    </div>
  );
}

/**
 * «الهيكل» — who answers to whom. One body, three readers (src/server/policy/team-development.ts decides which): the owner and whoever holds `people.manage_lines` see the
 * whole tree with «غيّر المسؤول»; a supervisor themselves and the people below them; everybody else only their own supervisor and their team mates.
 */
export async function StructureBody({ actor, where = OLD_DEVELOPMENT }: { actor: Actor; where?: Pick<DevelopmentWhere, "developmentHref" | "heading"> }) {
  const structure = await loadStructure(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { t } = getServerT();
  const Title = where.heading;
  const me = structure.me;
  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <Title className="text-xl font-semibold tracking-tight">{t("teamdev.structure.title")}</Title>
        <p className="mt-1 text-sm text-fg-muted">{t(structure.mode === "all" ? "teamdev.structure.subtitle_all" : structure.mode === "subtree" ? "teamdev.structure.subtitle_subtree" : "teamdev.structure.subtitle_own")}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-3 text-sm shadow-card" data-my-line>
        <h2 className="mb-2 font-medium">{t("teamdev.structure.mine")}</h2>
        <p>
          <span className="text-fg-muted">{t("teamdev.structure.my_supervisor")}: </span>
          {me.supervisor ? <span data-my-supervisor>{me.supervisor.name}</span> : <span className="text-fg-muted">{t("members.manager_owner")}</span>}
        </p>
        {me.teamMates.length > 0 ? (
          <p className="mt-1 leading-7">
            <span className="text-fg-muted">{t("teamdev.structure.my_team")}: </span>
            {me.teamMates.map((m) => m.name).join("، ")}
          </p>
        ) : null}
      </section>

      {structure.mode === "own" ? null : <StructureTree structure={structure} t={t} />}

      <p className="text-xs text-fg-muted">
        <Link href={where.developmentHref} className="underline">
          {t("teamdev.structure.to_development")}
        </Link>
      </p>
    </div>
  );
}
