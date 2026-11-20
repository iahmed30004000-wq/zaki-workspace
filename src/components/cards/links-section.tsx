"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/lib/api-client";
import type { LinksView } from "@/lib/cards/page";

export const linksKey = (cardId: string) => ["card", cardId, "links"] as const;

/**
 * What the card became: the tasks made from it and the topic it was sent to. The server lists only what the viewer may
 * open (a topic they cannot read, a task outside their scope, is simply not there).
 */
export function LinksSection({ cardId, version, initial }: { cardId: string; version?: number; initial?: LinksView }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: [...linksKey(cardId), version ?? 0],
    queryFn: () => apiGet<LinksView>(`/api/cards/${cardId}/links`),
    ...(initial ? { initialData: initial } : {}),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  if (!data) return null;
  const empty = data.tasks.length === 0 && data.topics.length === 0;
  return (
    <section aria-label={t("cards.p.links")} className="flex flex-col gap-2 rounded-[14px] bg-surface-1 p-3">
      <h3 className="text-sm font-semibold text-fg">{t("cards.p.links")}</h3>
      {empty ? <p className="text-xs text-fg-muted">{t("cards.p.links_none")}</p> : null}
      {data.tasks.length > 0 ? (
        <div>
          <p className="text-xs text-fg-muted">{t("cards.p.links_tasks")}</p>
          <ul className="m-0 flex flex-col p-0">
            {data.tasks.map((task) => (
              <li key={task.id} className="list-none">
                <Link href={`/tasks/${task.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-info hover:underline">
                  <ListTodo className="size-4 shrink-0" aria-hidden="true" />
                  <span dir="ltr" className="shrink-0 text-xs text-fg-muted">{task.key}</span>
                  <span dir="auto" className="min-w-0 truncate">{task.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.topics.length > 0 ? (
        <div>
          <p className="text-xs text-fg-muted">{t("cards.p.links_topics")}</p>
          <ul className="m-0 flex flex-col p-0">
            {data.topics.map((topic) => (
              <li key={`${topic.conversationId}:${topic.messageId ?? ""}`} className="list-none">
                <Link
                  href={topic.messageId ? `/chat/${topic.conversationId}?m=${encodeURIComponent(topic.messageId)}` : `/chat/${topic.conversationId}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm text-info hover:underline"
                >
                  <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
                  <span dir="auto" className="min-w-0 truncate">{topic.title}</span>
                  {topic.messageId ? <span className="shrink-0 text-xs text-fg-muted">{t("cards.p.link_message")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
