import Link from "next/link";
import { AR } from "@/lib/i18n/dict";
import { goHref } from "@/lib/space-link";
import type { LinkKind } from "@/lib/approvals/shared";
import type { ListItem } from "@/lib/approvals/view";
import { RequestCard } from "./request-card";

/**
 * «طلبات الموافقة المرتبطة» on a task or a card: the button that opens the new-request form already linked to this thing, and the
 * requests about it that the viewer may read (the server decided which). Server-renderable on purpose (no hooks): the task page and
 * the card page draw it, and a render test reads it. The button goes through `/go` so the form opens in THIS thing's own space (a
 * request is made in one space and its link must be of the same one).
 */
export function LinkedApprovals({ kind, id, workspaceId, canAsk, items }: { kind: LinkKind; id: string; workspaceId: string; canAsk: boolean; items: ListItem[] }) {
  const t = (key: string) => AR[key] ?? key;
  return (
    <section aria-label={t("approvals.link.title")} data-linked-approvals={kind} className="space-y-2 rounded-xl border border-border bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{t("approvals.link.title")}</h2>
        {canAsk ? (
          <Link
            href={goHref(workspaceId, `/approvals?new=1&link=${kind}:${id}`)}
            title={t("approvals.link.ask_hint")}
            data-linked-approvals-ask
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-9"
          >
            {t("approvals.link.ask")}
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted" data-linked-approvals-empty>
          {t("approvals.link.empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-linked-approvals-list>
          {items.map((item) => (
            <RequestCard key={item.id} item={item} />
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-fg-muted">{t("approvals.link.note")}</p>
    </section>
  );
}
