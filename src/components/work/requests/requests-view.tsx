"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GROUP_HEADING, QuietEmpty, WORK_LIST } from "@/components/work/look";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { goHref } from "@/lib/space-link";
import { REQUEST_TABS, type RequestGroup, type RequestSection, type RequestTab, type WorkRequestsView } from "./types";
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
    <div dir="rtl" className="mx-auto max-w-4xl space-y-3 p-4 md:p-5" data-work-requests={tab}>
      <header className="space-y-0.5">
        <h1 className="text-[19px] font-bold leading-tight text-fg">{t("workreq.title")}</h1>
        {/* each space is its own account: the line says whose these requests are */}
        <p className="text-[13px] text-fg-muted">{view.space ? t("workreq.subtitle.space", { name: view.space.name }) : view.groups ? t("workreq.subtitle.all") : t("workreq.subtitle")}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("workreq.tabs")} className="inline-flex shrink-0 rounded-[10px] bg-surface-2 p-[3px]">
          {REQUEST_TABS.map((key) => (
            <TabLink key={key} tab={key} current={tab} count={key === "waiting" && key === tab ? view.total : null} />
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Link href="/approvals?new=1" className="inline-flex min-h-11 items-center rounded-[10px] bg-accent px-4 text-[13.5px] font-semibold text-accent-fg transition-[filter] hover:brightness-110 md:min-h-9">
            {t("workreq.link.new")}
          </Link>
          <Link href="/approvals/forms" className="inline-flex min-h-11 items-center rounded-[10px] bg-accent/10 px-4 text-[13.5px] font-semibold text-accent transition-colors hover:bg-accent/20 md:min-h-9">
            {t("workreq.link.forms")}
          </Link>
          {/* the lists the other pages keep: «الموافقات» is the full approvals page */}
          <Link href={`/approvals?v=${tab}`} className="inline-flex min-h-11 items-center rounded-[10px] bg-accent/10 px-4 text-[13.5px] font-semibold text-accent transition-colors hover:bg-accent/20 md:min-h-9">
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
        <QuietEmpty title={t(`workreq.empty.${tab}.title`)} hint={t(`workreq.empty.${tab}.hint`)} />
      ) : view.groups ? (
        view.groups.map((group) => <GroupBlock key={group.spaceId ?? "company"} group={group} tab={tab} viewerId={view.viewerId} />)
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
      className={cn("inline-flex min-h-8 items-center whitespace-nowrap rounded-lg px-3 text-[13.5px] font-semibold transition-colors", active ? "bg-surface-1 text-fg shadow-card" : "text-fg-muted hover:text-fg")}
    >
      {count && count > 0 ? `${label} (${fmtNumber(count)})` : label}
    </Link>
  );
}

/**
 * B4 — inside «الشركة»: one block per space that has something waiting (its name, its count and «انتقل», the `/go` link that enters that space on its own
 * «الطلبات»), then the company-wide one. The rows inside are the very same sections of a space's own screen.
 */
function GroupBlock({ group, tab, viewerId }: { group: RequestGroup; tab: RequestTab; viewerId: string }) {
  const { t } = useI18n();
  const key = group.spaceId ?? "company";
  return (
    <section aria-labelledby={`workreq-group-${key}`} data-request-group={key} className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <h2 id={`workreq-group-${key}`} className="min-w-0 flex-1 truncate text-[15px] font-bold text-fg">
          {group.name ?? t("workreq.group.company")}
          <span className="ms-2 text-[13px] font-semibold text-fg-muted">{t("workreq.count", { n: fmtNumber(group.total) })}</span>
        </h2>
        {group.spaceId ? (
          <a href={goHref(group.spaceId, `/requests?tab=${tab}`)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-[13.5px] font-semibold text-accent transition-colors hover:bg-surface-2 md:min-h-9">
            {t("workreq.group.go")}
          </a>
        ) : null}
      </div>
      {group.sections
        .filter((section) => section.total > 0)
        .map((section) => (
          <SectionBlock key={section.key} section={section} tab={tab} viewerId={viewerId} idPrefix={key} />
        ))}
    </section>
  );
}

function SectionBlock({ section, tab, viewerId, idPrefix = "" }: { section: RequestSection; tab: RequestTab; viewerId: string; idPrefix?: string }) {
  const { t } = useI18n();
  const id = `workreq-${idPrefix ? `${idPrefix}-` : ""}${section.key}`;
  const hidden = section.total - section.rows.length;
  return (
    <section aria-labelledby={id} data-request-section={section.key}>
      <h2 id={id} className={GROUP_HEADING}>
        {t(tab === "mine" ? `workreq.section.${section.key}.mine` : `workreq.section.${section.key}`)}
        <span aria-hidden="true">·</span>
        <span className="font-semibold">{t("workreq.count", { n: fmtNumber(section.total) })}</span>
      </h2>
      <ul className={WORK_LIST}>
        {section.rows.map((row) => (
          <RequestRowView key={`${row.kind}:${row.id}`} row={row} viewerId={viewerId} />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="px-1 pt-2 text-[13px] text-fg-muted">
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
