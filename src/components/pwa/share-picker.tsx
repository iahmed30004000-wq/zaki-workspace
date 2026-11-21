"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useChatList, useChatSpace } from "@/lib/chat/cache/selectors";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { loadComposerDraft, saveComposerDraft } from "@/lib/chat/composer-draft";
import { ct } from "@/lib/chat/text";
import { chatHref } from "@/lib/chat/v2/routes";
import { appendSharedText } from "@/lib/pwa/share";
import { shareTargetsOf, spaceTargetsOf } from "@/lib/pwa/share-targets";
import { cn } from "@/lib/utils";

/**
 * M1a — «ابعت لـ…»: the page the phone's share sheet opens (`/share?title&text&url`, `src/app/share/page.tsx`). It lists the person's conversations from the
 * C1 list cache (the device's copy paints it at once), searchable; a SPACE row opens its topics. Choosing a conversation puts the shared words into THAT
 * conversation's composer as an unsent draft (`composer-draft.ts`, after anything the person had already typed there) and opens it.
 *
 * ⚠️ It NEVER sends: nothing in this file posts a message, it only writes a draft and navigates. 🔧 The person reads the words in the composer, changes them if
 * they like and presses send themselves (the note on the page says so). The page owns the `<main>` landmark (`src/app/share/page.tsx`): this file draws the inside.
 */

export type SharePickerState = "ready" | "loading" | "error";

export interface SharePickerViewProps {
  text: string;
  rows: readonly ChatRowDto[];
  state: SharePickerState;
  query: string;
  onQuery: (query: string) => void;
  onPick: (row: ChatRowDto) => void;
  onRetry: () => void;
  /** set while the topics of one space are shown (the second step) */
  space: { name: string } | null;
  onBack: () => void;
}

function Mark({ row }: { row: ChatRowDto }) {
  if (row.kind === "TOPIC" || row.kind === "SPACE") {
    return (
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-xl">
        {row.emoji ?? (row.kind === "SPACE" ? "🗂️" : "💬")}
      </span>
    );
  }
  return <Avatar name={row.title} src={row.kind === "DM" ? row.avatarUrl : null} className="size-12 text-sm" />;
}

/** What the page looks like: no state and no cache, so it can be rendered (and tested) on the server. */
export function SharePickerView({ text, rows, state, query, onQuery, onPick, onRetry, space, onBack }: SharePickerViewProps): React.JSX.Element {
  return (
    <div data-share-picker="" className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{space ? space.name : ct("mobile.share.title")}</h1>
        <section aria-label={ct("mobile.share.preview_label")} className="mt-3 rounded-xl border border-border bg-surface-1 p-3">
          <p className="text-xs font-semibold text-fg-muted">{ct("mobile.share.preview_label")}</p>
          <p data-share-text="" dir="auto" className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6">
            {text}
          </p>
          <p className="mt-2 text-xs leading-5 text-fg-muted">{ct("mobile.share.never_sends")}</p>
        </section>
        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.currentTarget.value)}
            aria-label={ct("mobile.share.search")}
            placeholder={ct("mobile.share.search")}
            className="h-11 w-full rounded-lg border border-muted bg-surface ps-9 pe-3 text-base"
          />
        </div>
        {space ? (
          <Button type="button" variant="ghost" onClick={onBack} className="mt-2 h-11 px-3">
            {ct("mobile.share.back")}
          </Button>
        ) : null}
      </header>

      {state === "loading" ? (
        <p role="status" className="p-4 text-sm text-fg-muted">
          {ct("mobile.share.loading")}
        </p>
      ) : state === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2 p-4">
          <p className="text-sm text-danger">{ct("mobile.share.failed")}</p>
          <Button type="button" variant="secondary" onClick={onRetry} className="h-11 px-5">
            {ct("mobile.share.retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-fg-muted">{ct(query.trim() ? "mobile.share.no_match" : "mobile.share.no_chats")}</p>
      ) : (
        <ul aria-label={ct("mobile.share.list_label")} className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                data-share-row={row.kind}
                onClick={() => onPick(row)}
                className={cn("flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent")}
              >
                <Mark row={row} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium">{row.title}</span>
                  {row.kind === "SPACE" ? (
                    <span className="truncate text-sm text-fg-muted">{ct("mobile.share.space_topics")}</span>
                  ) : row.space ? (
                    <span className="truncate text-sm text-fg-muted">{row.space.name}</span>
                  ) : null}
                </span>
                {row.kind === "SPACE" ? <ChevronLeft aria-hidden="true" className="size-5 shrink-0 text-fg-muted" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The picker with the C1 list cache behind it and the draft + navigation as its action. `userId` keys the person's drafts. */
export function SharePicker({ userId, text }: { userId: string; text: string }): React.JSX.Element {
  const router = useRouter();
  const list = useChatList("all");
  const [query, setQuery] = useState("");
  const [space, setSpace] = useState<{ id: string; name: string } | null>(null);
  const forum = useChatSpace(space?.id ?? null);

  const targets = useMemo(() => shareTargetsOf(list.rows, { scope: list.scope, spaceId: list.spaceId }, query), [list.rows, list.scope, list.spaceId, query]);
  const topics = useMemo(() => spaceTargetsOf(forum.rows, query), [forum.rows, query]);

  const pick = (row: ChatRowDto) => {
    if (row.kind === "SPACE") {
      setQuery("");
      setSpace({ id: row.id, name: row.title });
      return;
    }
    // the words wait in THAT conversation's composer, after whatever was already typed there; nothing is sent from here
    const before = loadComposerDraft(userId, row.id);
    saveComposerDraft(userId, row.id, { body: appendSharedText(before?.body, text), mentions: before?.mentions ?? [] });
    router.push(chatHref.conversation(row.id));
  };

  const inSpace = space !== null;
  const state: SharePickerState = inSpace
    ? forum.isError && forum.rows.length === 0
      ? "error"
      : forum.isPending && forum.rows.length === 0
        ? "loading"
        : "ready"
    : list.isError && list.rows.length === 0
      ? "error"
      : list.isPending && list.rows.length === 0
        ? "loading"
        : "ready";

  return (
    <SharePickerView
      text={text}
      rows={inSpace ? topics : targets}
      state={state}
      query={query}
      onQuery={setQuery}
      onPick={pick}
      onRetry={() => void (inSpace ? forum.refetch() : list.refetch())}
      space={space ? { name: forum.space?.name ?? space.name } : null}
      onBack={() => {
        setQuery("");
        setSpace(null);
      }}
    />
  );
}

/** The page when there is nothing to share (the address carried no words): where to go instead. */
export function ShareEmpty(): React.JSX.Element {
  return (
    <div data-share-empty="" className="flex flex-1 flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">{ct("mobile.share.empty")}</h1>
      <p className="text-sm text-fg-muted">{ct("mobile.share.empty_hint")}</p>
      <Link href={chatHref.list} className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg">
        {ct("mobile.share.to_chat")}
      </Link>
    </div>
  );
}
