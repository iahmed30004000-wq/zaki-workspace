"use client";

import React from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import type { OversightConversationDto } from "@/server/chat/dto";
import { ct, ctCount } from "@/lib/chat/text";
import { chatHref } from "@/lib/chat/v2/routes";
import { useOversightList } from "@/lib/chat/v2/use-oversight";

/**
 * C2.2 — «كل الشركة»: every conversation of the company, for the people who hold the silent oversight (`canOversee`, the capability `archive.view`;
 * P0.1). It keeps TODAY'S rule exactly: it is the same read as the old home's «كل الشركة» (the server answers it for nobody else and leaves no trace),
 * and its rows say NOTHING about reading — no unread number, no ticks, no «seen». A row is a title (a private chat is «خاص: سارة وأحمد»), its space and
 * its size, and a link that opens the conversation the way the old list did. The screen's own words say once, at the top, that this reading is silent.
 */
export function companyTitle(item: Pick<OversightConversationDto, "kind" | "title" | "names">): string {
  if (item.kind === "DM") return item.names?.length === 2 ? ct("chath.company.dm", { a: item.names[0]!, b: item.names[1]! }) : ct("chath.company.dm_fallback");
  return item.title || ct("chatc.title_fallback");
}

export function CompanyRowsView({
  items,
  more,
  loading,
  failed,
  onRetry,
  selectedId,
}: {
  items: readonly OversightConversationDto[];
  more: boolean;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  selectedId: string | null;
}) {
  return (
    <div data-chat-company="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <p className="flex items-start gap-2 border-b border-border/60 px-3 py-2 text-xs leading-5 text-fg-muted">
        <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {ct("chath.company.hint")}
      </p>
      {failed ? (
        <p role="alert" className="px-3 py-3 text-sm text-danger">
          {ct("chath.load_failed")}{" "}
          <button type="button" onClick={onRetry} className="min-h-11 underline">
            {ct("chath.retry")}
          </button>
        </p>
      ) : null}
      {loading && !failed ? (
        <p role="status" className="px-3 py-3 text-sm text-fg-muted">
          {ct("chath.loading")}
        </p>
      ) : null}
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const on = selectedId === item.id;
          return (
            <li key={item.id} data-company-row="" className={on ? "bg-accent text-accent-fg" : "hover:bg-surface-2"}>
              <Link href={chatHref.conversation(item.id)} scroll={false} prefetch={false} aria-current={on ? "page" : undefined} className="flex min-h-14 flex-col justify-center px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                <span className="truncate text-base font-medium">
                  <bdi>{companyTitle(item)}</bdi>
                </span>
                <span className={on ? "truncate text-xs text-accent-fg/80" : "truncate text-xs text-fg-muted"}>
                  {item.spaceName ?? ct("chath.company.no_space")} · {ctCount("chath.participants", item.membersCount)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more ? <p className="px-3 py-2 text-xs text-fg-muted">{ct("chath.company.more")}</p> : null}
    </div>
  );
}

/** The folder, connected: fetched only while it is open. */
export function CompanyRows({ selectedId }: { selectedId: string | null }) {
  const query = useOversightList(true);
  return <CompanyRowsView items={query.data?.items ?? []} more={Boolean(query.data?.nextCursor)} loading={query.isPending} failed={query.isError} onRetry={() => void query.refetch()} selectedId={selectedId} />;
}
