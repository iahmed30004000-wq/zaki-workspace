import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT, type ServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { orgTimeZone } from "@/server/services/org-day";
import { dayKeyOf } from "@/lib/owner-board";
import { periodChoices, pickerPeriods } from "@/lib/team-score";
import { loadPersonHeader } from "@/server/services/team-people";
import { listSkills, loadPersonSkills, loadSkillHistory } from "@/server/services/team-skills";
import { listCriteria } from "@/server/services/team-criteria";
import { listReviews } from "@/server/services/team-reviews";
import { listGoals, listNotes } from "@/server/services/team-plans";
import { loadPersonScore } from "@/server/services/team-score";
import { PersonSkills } from "./person-skills";
import { PeriodPicker, ScoreView, periodLabel } from "./score-panel";
import { ReviewsPanel } from "./reviews-panel";
import { PlanPanel } from "./plan-panel";
import { NotesPanel } from "./notes-panel";

/**
 * «ملف الأداء والتطوير» of one person — the body shared by /development/people/[id] and by /development for a person who reads
 * nobody but themselves. The tabs are plain links (`?tab=`): one request per page, and only the tab shown is read. A person the
 * viewer may not open, a guest and the company with the feature switched off get «not found» (never «forbidden»). Reading writes
 * nothing. The owner's own file has the skills tab only: nobody scores, reviews or plans the owner.
 */
export const PERSON_TABS = ["skills", "score", "reviews", "plan", "notes"] as const;
export type PersonTab = (typeof PERSON_TABS)[number];

export function tabOf(asked: string | string[] | undefined): PersonTab {
  const one = Array.isArray(asked) ? asked[0] : asked;
  return (PERSON_TABS as readonly string[]).includes(one ?? "") ? (one as PersonTab) : "skills";
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function PersonFile({ actor, userId, tab, basePath, query = {} }: { actor: Actor; userId: string; tab: PersonTab; basePath: string; query?: Record<string, string | string[] | undefined> }) {
  const miss = (err: unknown): never => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  };
  const person = await loadPersonHeader(actor, userId).catch(miss);
  const { t } = getServerT();
  // nobody scores, reviews or plans the owner: his file is his skills
  const tabs = person.role === "OWNER" ? (["skills"] as const) : PERSON_TABS;
  const shown: PersonTab = (tabs as readonly string[]).includes(tab) ? tab : "skills";
  const period = first(query["period"]);

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{person.isSelf ? t("nav.tab.myFile") : person.name}</h1>
          {person.isSelf ? null : (
            <Link href="/development" className="text-sm text-info underline">
              {t("teamdev.back")}
            </Link>
          )}
        </div>
        <p className="text-sm text-fg-muted">
          {person.isSelf ? `${person.name} · ` : ""}
          {person.jobTitle ? `${person.jobTitle} · ` : ""}
          {person.supervisor ? `${t("teamdev.col.supervisor")}: ${person.supervisor.name}` : t("teamdev.structure.no_supervisor")}
        </p>
        {person.inactive ? <p className="text-xs text-warn">⚠️ {t("teamdev.person.inactive")}</p> : null}
      </header>

      <nav className="flex gap-2 overflow-x-auto" aria-label={t("teamdev.title")}>
        {tabs.map((key) => (
          <Link
            key={key}
            href={`${basePath}?tab=${key}`}
            aria-current={shown === key ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm md:min-h-9 ${shown === key ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2"}`}
            data-person-tab={key}
          >
            {t(`teamdev.tab.${key}`)}
          </Link>
        ))}
      </nav>

      {shown === "skills" ? <SkillsTab actor={actor} userId={userId} canEnter={person.canEnter} isSelf={person.isSelf} miss={miss} /> : null}
      {shown === "score" ? <ScoreTab actor={actor} userId={userId} basePath={basePath} period={period} t={t} miss={miss} /> : null}
      {shown === "reviews" ? <ReviewsTab actor={actor} userId={userId} canEnter={person.canEnter} isSelf={person.isSelf} t={t} miss={miss} /> : null}
      {shown === "plan" ? <PlanTab actor={actor} userId={userId} canEnter={person.canEnter} isSelf={person.isSelf} miss={miss} /> : null}
      {shown === "notes" ? <NotesTab actor={actor} userId={userId} canEnter={person.canEnter} isSelf={person.isSelf} miss={miss} /> : null}
    </div>
  );
}

type Miss = (err: unknown) => never;

async function SkillsTab({ actor, userId, canEnter, isSelf, miss }: { actor: Actor; userId: string; canEnter: boolean; isSelf: boolean; miss: Miss }) {
  const [rows, history] = await Promise.all([loadPersonSkills(actor, userId).catch(miss), loadSkillHistory(actor, userId).catch(miss)]);
  return <PersonSkills userId={userId} rows={rows} history={history} canEnterManual={canEnter} isSelf={isSelf} />;
}

async function ScoreTab({ actor, userId, basePath, period, t, miss }: { actor: Actor; userId: string; basePath: string; period: string | undefined; t: ServerT; miss: Miss }) {
  const score = await loadPersonScore(actor, userId, { period }).catch(miss);
  const org = await orgTimeZone(actor.orgId);
  const options = pickerPeriods(dayKeyOf(new Date(), org));
  return (
    <div className="space-y-4">
      <PeriodPicker t={t} action={basePath} options={options} selected={score.period.key} extra={{ tab: "score" }} />
      <p className="text-sm text-fg-muted">
        {periodLabel(options.find((p) => p.key === score.period.key) ?? options[0]!, t)} · {score.period.from} → {score.period.to}
      </p>
      <ScoreView score={score} t={t} />
    </div>
  );
}

async function ReviewsTab({ actor, userId, canEnter, isSelf, t, miss }: { actor: Actor; userId: string; canEnter: boolean; isSelf: boolean; t: ServerT; miss: Miss }) {
  const [reviews, criteria] = await Promise.all([listReviews(actor, userId).catch(miss), listCriteria(actor, { all: true }).catch(miss)]);
  const tz = await orgTimeZone(actor.orgId);
  const periods = periodChoices(dayKeyOf(new Date(), tz), t);
  return <ReviewsPanel userId={userId} reviews={reviews} criteria={criteria} periods={periods} canWrite={canEnter} selfView={isSelf} />;
}

async function PlanTab({ actor, userId, canEnter, isSelf, miss }: { actor: Actor; userId: string; canEnter: boolean; isSelf: boolean; miss: Miss }) {
  const [goals, skills] = await Promise.all([listGoals(actor, userId).catch(miss), listSkills(actor).catch(miss)]);
  return <PlanPanel userId={userId} goals={goals} skills={skills} canEnter={canEnter} isSelf={isSelf} />;
}

async function NotesTab({ actor, userId, canEnter, isSelf, miss }: { actor: Actor; userId: string; canEnter: boolean; isSelf: boolean; miss: Miss }) {
  const notes = await listNotes(actor, userId).catch(miss);
  return <NotesPanel userId={userId} notes={notes} canWrite={canEnter} selfView={isSelf} />;
}
