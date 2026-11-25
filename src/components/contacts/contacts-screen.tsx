"use client";

import React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { BotFatherRow } from "@/components/chat/botfather-row";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { useI18n } from "@/lib/i18n";
import { filterContacts, sortContacts, type ContactPerson } from "@/lib/contacts";
import { lastSeenLabel } from "@/lib/last-seen";

/**
 * «جهات الاتصال» as Telegram draws it (S6.3, the bar's second tab): a search pill, a card of the company's people sorted by when they were last seen (the line under each
 * name), a tap opens that person's page (`/u/{id}`, where «رسالة» is). The people are the chat directory's (the server already hides what a person chose to hide). `now` is the
 * server's clock, so the first paint says the same thing on both sides.
 */
export function ContactsScreen({ people, now, botFather = false }: { people: ContactPerson[]; now: string; /** «بوت فاذر» is offered to me (the owner and the admins, its switch on) */ botFather?: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const instant = React.useMemo(() => new Date(now), [now]);
  const shown = React.useMemo(() => sortContacts(filterContacts(people, query)), [people, query]);
  const anySeen = people.some((p) => p.lastSeenAt);
  return (
    <div data-contacts-screen className="mx-auto flex max-w-2xl flex-col gap-3 px-3 pb-24 pt-[max(env(safe-area-inset-top),0.75rem)] md:pb-6">
      <h1 className="text-center text-lg font-semibold text-fg">{t("contacts.title")}</h1>
      <label className="flex min-h-11 items-center gap-2 rounded-full border border-border/60 bg-surface-1 px-4 shadow-card">
        <Search aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
        <span className="sr-only">{t("contacts.search")}</span>
        <input
          type="search"
          data-contact-search
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("contacts.search")}
          className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
        />
      </label>
      {botFather ? <BotFatherRow className="overflow-hidden rounded-2xl border border-border/60 bg-surface-1 shadow-card" /> : null}
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-1 p-6 text-center text-sm text-fg-muted">{people.length === 0 ? t("contacts.empty") : t("contacts.no_match")}</p>
      ) : (
        <section aria-label={t("contacts.title")} className="rounded-2xl border border-border/60 bg-surface-1 shadow-card">
          <h2 className="px-4 pb-1 pt-3 text-sm font-semibold text-accent">{anySeen ? t("contacts.sorted_seen") : t("contacts.sorted_name")}</h2>
          <ul>
            {shown.map((p) => {
              const seen = lastSeenLabel({ online: false, lastSeenAt: p.lastSeenAt }, { now: instant });
              return (
                <li key={p.userId}>
                  <Link href={`/u/${p.userId}`} data-contact-row={p.userId} className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <Avatar name={p.name} src={p.avatarUrl ?? null} className="size-12 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-fg">
                        {p.name}
                        {p.verified ? <VerifiedBadge className="ms-1" /> : null}
                      </span>
                      {seen !== null ? <span className="block truncate text-sm text-fg-muted">{seen}</span> : p.jobTitle ? <span className="block truncate text-sm text-fg-muted">{p.jobTitle}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
