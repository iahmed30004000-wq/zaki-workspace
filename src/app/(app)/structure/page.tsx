import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { loadStructure } from "@/server/services/team-lines";
import { StructureTree } from "@/components/structure/structure-tree";

/**
 * «الهيكل» — who answers to whom. One page, three readers (src/server/policy/team-development.ts decides which):
 *   the owner and whoever holds `people.manage_lines`  the whole company's tree, with «غيّر المسؤول» (the shared `ManagerPicker`, for the people the viewer outranks) and the people nobody answers for;
 *   a supervisor                                       themselves and the people below them;
 *   everybody else                                     only their own supervisor and the names of their team mates.
 * An external partner, or the company with «الأداء والتطوير» switched off, gets «not found». Reading writes nothing.
 */
export default async function StructurePage() {
  const { actor } = await pageActor();
  const structure = await loadStructure(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { t } = getServerT();
  const me = structure.me;
  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t("teamdev.structure.title")}</h1>
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
        <Link href="/development" className="underline">
          {t("teamdev.structure.to_development")}
        </Link>
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";
