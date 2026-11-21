"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { goHref } from "@/lib/space-link";

export interface StarterTopic {
  title: string;
  emoji: string;
  /** ALL (everybody writes) or ADMINS (the space's admins write, the rest read). */
  postingPolicy: "ALL" | "ADMINS";
}

/**
 * «الدردشة» — the topics every space starts with and who may open a new one. This is what the space does TODAY (the starter topics are fixed, and a topic is opened
 * by the owner or the space's admin): it is shown, not editable, and the tab says so. No topic of the space is listed here: a topic restricted to named people stays
 * theirs, and a settings page is no way to read around that.
 */
export function ChatTab({ spaceId, starters }: { spaceId: string; starters: StarterTopic[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5" data-space-settings-chat>
      <section className="space-y-2 rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-sm font-semibold text-fg">{t("spset.chat.starters")}</h2>
        <p className="text-xs leading-5 text-fg-muted">{t("spset.chat.starters_hint")}</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {starters.map((topic) => (
            <li key={topic.title} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span aria-hidden="true">{topic.emoji}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-fg">
                <bdi>{topic.title}</bdi>
              </span>
              <span className="shrink-0 text-xs text-fg-muted">{t(`spset.chat.policy.${topic.postingPolicy}`)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-1 rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-sm font-semibold text-fg">{t("spset.chat.who_opens")}</h2>
        <p className="text-sm text-fg">{t("spset.chat.who_opens_body")}</p>
        <p className="text-xs leading-5 text-fg-muted">{t("spset.chat.fixed")}</p>
      </section>
      <Link href={goHref(spaceId, "/chat")} className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2">
        {t("spset.chat.go")}
      </Link>
    </div>
  );
}
