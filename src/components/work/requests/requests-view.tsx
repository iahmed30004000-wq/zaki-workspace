"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { REQUEST_TABS, type RequestSection, type RequestTab, type WorkRequestsView } from "./types";
import { RequestRowView, WORK_REQUESTS_KEY } from "./request-rows";

/**
 * «الطلبات» — one screen, two tabs: «بانتظاري» (what waits for me) and «طلباتي» (what I asked and still waits). The server hands the first
 * answer (already filtered by what the person may see); an action on a row refetches it, so a row leaves the list without a reload.
 * The approvals pages (the list, a request's page, the forms) stay where they were: this screen links into them.
 */
export function RequestsView({ initial }: { initial: WorkRequestsView }) {
  const { t } = useI18n();
  const tab = initial.tab;
  const query = useQuery({
    queryKey: [...WORK_REQUESTS_KEY, tab, initial.builtAt],
    queryFn: () => apiGet<WorkRequestsView>(`/api/work/requests?tab=${tab}`),
    initialData: initial,
    // the server's answer is fresh when the page opens; an action invalidates it
    staleTime: 30_000,
  });
  const view = query.data;
  const visible = view.sections.filter((section) => section.total > 0);
  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" data-work-requests={tab}>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("workreq.title")}</h1>
        <p className="text-sm text-muted">{t("workreq.subtitle")}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("workreq.tabs")} className="flex flex-wrap gap-1">
          {REQUEST_TABS.map((key) => (
            <TabLink key={key} tab={key} current={tab} count={key === "waiting" && key === tab ? view.total : null} />
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Link href="/approvals?new=1" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:min-h-9">
            {t("workreq.link.new")}
          </Link>
          <Link href="/approvals/forms" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-fg hover:bg-surface-2 md:min-h-9">
            {t("workreq.link.forms")}
          </Link>
          {/* the lists the other pages keep: «الموافقات» is the full approvals page */}
          <Link href={`/approvals?v=${tab}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-fg hover:bg-surface-2 md:min-h-9">
            {t("workreq.open_all")}
          </Link>
        </div>
      </div>
      {query.isError ? (
        <div className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">
          <span>{t("workreq.error.load")}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
            {t("workreq.error.retry")}
          </Button>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState title={t(`workreq.empty.${tab}.title`)} hint={t(`workreq.empty.${tab}.hint`)} />
      ) : (
        visible.map((section) => <SectionBlock key={section.key} section={section} tab={tab} viewerId={view.viewerId} />)
      )}
    </div>
  );
}

function TabLink({ tab, current, count }: { tab: RequestTab; current: RequestTab; count: number | null }) {
  const { t } = useI18n();
  const active = tab === current;
  const label = t(`workreq.tab.${tab}`);
  return (
    <Link
      href={`/requests?tab=${tab}`}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg border px-3 py-1.5 text-sm ${active ? "border-accent/60 bg-accent/10 font-medium text-fg" : "border-border text-fg-muted hover:bg-surface-2"}`}
    >
      {count && count > 0 ? `${label} (${fmtNumber(count)})` : label}
    </Link>
  );
}

function SectionBlock({ section, tab, viewerId }: { section: RequestSection; tab: RequestTab; viewerId: string }) {
  const { t } = useI18n();
  const id = `workreq-${section.key}`;
  const hidden = section.total - section.rows.length;
  return (
    <section aria-labelledby={id} className="space-y-2" data-request-section={section.key}>
      <h2 id={id} className="flex flex-wrap items-baseline gap-2 text-base font-semibold text-fg">
        {t(tab === "mine" ? `workreq.section.${section.key}.mine` : `workreq.section.${section.key}`)}
        <span className="text-xs font-normal text-fg-muted">{t("workreq.count", { n: fmtNumber(section.total) })}</span>
      </h2>
      <ul className="space-y-2">
        {section.rows.map((row) => (
          <RequestRowView key={`${row.kind}:${row.id}`} row={row} viewerId={viewerId} />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="text-xs text-fg-muted">
          {t("workreq.more", { n: fmtNumber(hidden) })}
          {section.allHref ? (
            <>
              {" "}
              <Link href={section.allHref} className="text-accent hover:underline">
                {t("workreq.row.open")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
