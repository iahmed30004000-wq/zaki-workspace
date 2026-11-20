import Link from "next/link";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtDMY } from "@/lib/format";
import { amountText } from "@/lib/approvals/shared";
import type { ListItem } from "@/lib/approvals/view";
import { StatusBadge } from "./status-badge";

/**
 * One request of a list. The title, who asked, the space, the state, who it waits on, the chain at a glance and the date; the amount
 * only when the server handed one (it never does for anybody who may not see it). The whole card is one link to the request.
 * Server-renderable on purpose (no hooks): the list page draws it and a render test reads it.
 */
export function RequestCard({ item, showSpace = false }: { item: ListItem; showSpace?: boolean }) {
  const t = (key: string, vars?: Record<string, string | number>) => interpolate(AR[key] ?? key, vars);
  const money = item.amount ? amountText(item.amount.minor, item.amount.currency) : "";
  return (
    <li className="list-none">
      <Link
        href={`/approvals/${item.id}`}
        data-approval-card={item.id}
        className="block rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{item.title}</span>
          <StatusBadge status={item.status} />
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {interpolate(t("approvals.card.by"), { name: item.requester.name })}
          {showSpace && item.workspaceName ? ` · ${item.workspaceName}` : ""}
          {item.version > 1 ? ` · ${interpolate(t("approvals.card.version"), { n: item.version })}` : ""}
          {` · ${fmtDMY(item.createdAt)}`}
        </p>
        {money ? (
          <p className="mt-1 text-xs font-medium text-fg" data-approval-amount>
            {money}
          </p>
        ) : null}
        {item.amountHidden ? (
          <p className="mt-1 text-xs text-fg-muted" data-approval-amount-hidden>
            {t("approvals.amount_hidden")}
          </p>
        ) : null}
        {item.waitingOn ? <p className="mt-1 text-xs text-warn">{interpolate(t("approvals.card.waiting_on"), { name: item.waitingOn.name })}</p> : null}
        {item.steps.length > 0 ? (
          <p className="mt-1 text-xs text-fg-muted">
            {item.steps.map((s, i) => (
              <span key={s.position}>
                {i > 0 ? " ← " : ""}
                <span className={s.status === "APPROVED" ? "text-ok" : s.status === "REJECTED" ? "text-danger" : undefined}>{s.approver.name}</span>
              </span>
            ))}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
