import Link from "next/link";
import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { AssistantProposals } from "@/components/chat/message/assistant-proposals";
import { NotFoundError } from "@/server/auth";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import { readMinutes, type MinutesView } from "@/server/calls/minutes";

/**
 * «محضر الاجتماع» of one call (S6.2): the summary, the decisions and the proposed tasks, written AFTER the call from its written lines (TEXT ONLY: no sound was ever
 * kept). For the OWNER (with the cards he approves and the full text) and for the person who started the call when staff (the minutes only). Everybody else, a guest
 * above all, and a company with the switch off: «not found». The page never touches the database itself.
 */
export default async function CallMinutesPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  const { t } = getServerT();
  let view: MinutesView;
  try {
    view = await readMinutes({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, params.id, { withTranscript: true });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const m = view.minutes;
  return (
    <main dir="rtl" lang="ar" className="mx-auto flex max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{t("calls.minutes.page_title")}</h1>
        <p className="text-sm text-fg-muted">
          {view.title ?? t("calls.minutes.untitled")} · {fmtDateTime(view.startedAt)}
        </p>
        <p className="text-xs text-fg-muted">{t("calls.minutes.after_note")}</p>
      </header>

      {view.state === "pending" && <p role="status" className="rounded-xl border border-border bg-surface-1 p-3 text-sm">{t("calls.minutes.pending")}</p>}
      {view.state === "empty" && <p role="status" className="rounded-xl border border-border bg-surface-1 p-3 text-sm">{t("calls.minutes.empty")}</p>}
      {view.state === "failed" && <p role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">{t("calls.minutes.failed")}</p>}
      {view.state === null && <p role="status" className="rounded-xl border border-border bg-surface-1 p-3 text-sm">{t("calls.minutes.none")}</p>}

      {m && (
        <>
          <section aria-labelledby="mm-summary" className="rounded-xl border border-border bg-surface-1 p-4">
            <h2 id="mm-summary" className="mb-2 font-semibold">{t("calls.minutes.summary")}</h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.summary}</p>
          </section>
          <section aria-labelledby="mm-decisions" className="rounded-xl border border-border bg-surface-1 p-4">
            <h2 id="mm-decisions" className="mb-2 font-semibold">{t("calls.minutes.decisions")}</h2>
            {m.decisions.length > 0 ? (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {m.decisions.map((d, i) => (
                  <li key={i} className="break-words">{d}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">{t("calls.minutes.no_decisions")}</p>
            )}
          </section>
          {m.tasks.length > 0 && (
            <section aria-labelledby="mm-tasks" className="rounded-xl border border-border bg-surface-1 p-4">
              <h2 id="mm-tasks" className="mb-1 font-semibold">{t("calls.minutes.tasks")}</h2>
              <p className="mb-2 text-xs text-fg-muted">{t("calls.minutes.tasks_note")}</p>
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {m.tasks.map((task, i) => (
                  <li key={i} className="break-words">
                    {task.title}
                    {task.who ? <span className="text-fg-muted"> ({task.who})</span> : null}
                  </li>
                ))}
              </ul>
              {m.proposals.length > 0 && <AssistantProposals ids={m.proposals.join(",")} />}
            </section>
          )}
        </>
      )}

      {view.transcript && view.transcript.length > 0 && (
        <details className="rounded-xl border border-border bg-surface-1 p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{t("calls.minutes.transcript")}</summary>
          <p className="my-2 text-xs text-fg-muted">{t("calls.minutes.kept", { days: view.days })}</p>
          <ol className="space-y-1 text-sm">
            {view.transcript.map((l, i) => (
              <li key={i} className="break-words">
                <span className="font-semibold">{l.name}</span>
                <span className="text-fg-muted"> · {fmtTime(l.at)}</span>
                <span>: {l.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <Link href={`/calls/${params.id}`} className="inline-flex min-h-11 w-fit items-center rounded-lg px-4 text-sm text-accent hover:bg-surface-2">
        {t("calls.minutes.back")}
      </Link>
    </main>
  );
}

export const dynamic = "force-dynamic";
