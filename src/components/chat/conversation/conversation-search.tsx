"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MessageHitDto } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { dayDiff, fmtShort, fmtTime } from "@/lib/format";
import { dayStartOf, inChatSearchUrl, isAskable, stepHit, stepOfSearchKey } from "@/lib/chat/v2/info/in-chat-search";

/** Today's hit shows its time, an older one its day (the app's own formatting, src/lib/format.ts). */
function whenOf(at: string): string {
  return dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at);
}

/**
 * «بحث بالمحادثة» (the owner's ask, 2026-10-25): the messages of this conversation that carry the words, newest
 * first; picking one opens the conversation around it (the screen scrolls to it and marks it).
 *
 * C3d — `enhanced` (the new chat screen only; the old screen does not pass it and behaves exactly as before): the panel STAYS open while the person walks the hits —
 * ↑ goes to the older one, ↓ to the newer one (the keys in the field, or the two buttons; Enter is ↑, Shift+Enter ↓), each step calls `onJump` — and it gains
 * «من:» (only the messages of one person of `people`) and a date jump (the first message of the day picked, from the same door). Both go through
 * `GET /api/search?scope=chat&conversationId=` (the old route does not know them). A click on a hit is an `onJump` too when there is one, an `onPick` otherwise.
 */
export function ConversationSearch({
  conversationId,
  onPick,
  onClose,
  enhanced = false,
  people,
  onJump,
}: {
  conversationId: string;
  onPick: (messageId: string) => void;
  onClose: () => void;
  enhanced?: boolean;
  /** «من:» — the people to choose from (the conversation's members); none: no person filter is offered */
  people?: readonly { id: string; name: string }[];
  /** a step between hits, a click on one and the date jump: scroll to the message and keep the panel open (without it each is an `onPick`) */
  onJump?: (messageId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const since = useMemo(() => (day ? dayStartOf(day) : null), [day]);
  const [hits, setHits] = useState<MessageHitDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const reach = enhanced && onJump ? onJump : onPick;

  // a short pause after typing, then one request (the last one wins)
  useEffect(() => {
    const words = q.trim();
    const asked = enhanced ? isAskable({ q, from, since }) : words.length >= 2;
    if (!asked) {
      setHits(null);
      setActive(null);
      setFailed(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      const url = enhanced
        ? inChatSearchUrl(conversationId, { q, from, since })
        : `/api/chat/conversations/${encodeURIComponent(conversationId)}/search?q=${encodeURIComponent(words)}`;
      fetch(url, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("search");
          return r.json() as Promise<{ hits?: MessageHitDto[]; messages?: MessageHitDto[] }>;
        })
        .then((data) => {
          if (!alive) return;
          const found = (enhanced ? data.messages : data.hits) ?? [];
          setFailed(false);
          setHits(found);
          setActive(null);
          // the date jump lands on its message at once
          if (enhanced && since && found[0]) {
            setActive(0);
            reach(found[0].id);
          }
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `reach` is the screen's own and changes with every render: only a new question asks again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, since, conversationId, enhanced]);

  const go = (direction: "older" | "newer") => {
    if (!hits) return;
    const next = stepHit(active, direction, hits.length);
    if (next === null) return;
    setActive(next);
    reach(hits[next]!.id);
  };

  return (
    <div className="border-b border-border p-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            // typing words leaves the date jump
            setDay("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (enhanced && hits && hits.length > 0) {
              const direction = stepOfSearchKey(e.key, e.shiftKey);
              if (direction) {
                e.preventDefault();
                go(direction);
              }
            }
          }}
          aria-label={ct("chatc.search.label")}
          placeholder={ct("chatc.search.placeholder")}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm"
        />
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-surface-2">
          {ct("chatc.search.close")}
        </button>
      </div>
      {enhanced ? (
        <div data-conversation-search-tools className="mt-2 flex flex-wrap items-center gap-2">
          {people && people.length > 0 ? (
            <label className="flex items-center gap-1.5 text-sm">
              <span className="text-fg-muted">{ct("chatcs.from")}</span>
              <select
                data-search-from
                value={from ?? ""}
                onChange={(e) => {
                  setFrom(e.currentTarget.value || null);
                  setDay("");
                }}
                className="h-11 max-w-40 rounded-lg border border-muted bg-surface px-2 text-base md:h-9 md:text-sm"
              >
                <option value="">{ct("chatcs.from_all")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-fg-muted">{ct("chatcs.date")}</span>
            <input
              type="date"
              data-search-date
              lang="ar"
              value={day}
              aria-label={ct("chatcs.date_label")}
              onChange={(e) => {
                setDay(e.currentTarget.value);
                // a day is a jump of its own: the words are left
                if (e.currentTarget.value) setQ("");
              }}
              className="h-11 rounded-lg border border-muted bg-surface px-2 text-base md:h-9 md:text-sm"
            />
          </label>
          <span className="ms-auto flex items-center gap-1">
            {hits && hits.length > 0 && active !== null ? (
              <span data-search-count aria-live="polite" className="px-1 text-sm text-fg-muted">
                {ct("chatcs.count", { n: active + 1, total: hits.length })}
              </span>
            ) : null}
            <button
              type="button"
              data-search-step="older"
              aria-label={ct("chatcs.prev")}
              title={ct("chatcs.hint")}
              disabled={!hits || hits.length === 0 || active === hits.length - 1}
              onClick={() => go("older")}
              className="grid size-11 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30 md:size-9"
            >
              <ChevronUp aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              data-search-step="newer"
              aria-label={ct("chatcs.next")}
              title={ct("chatcs.hint")}
              disabled={!hits || hits.length === 0 || active === null || active === 0}
              onClick={() => go("newer")}
              className="grid size-11 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30 md:size-9"
            >
              <ChevronDown aria-hidden="true" className="size-5" />
            </button>
          </span>
        </div>
      ) : null}
      {failed && <p role="alert" className="mt-2 text-sm text-danger">{ct("chatc.search.failed")}</p>}
      {hits && !failed && (
        <div role="status" className="mt-2">
          {hits.length === 0 ? (
            <p className="text-sm text-fg-muted">{ct(enhanced && since ? "chatcs.date_none" : "chatc.search.none")}</p>
          ) : (
            <ul aria-label={enhanced ? ct("chatcs.hits") : undefined} className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {hits.map((h, index) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (enhanced) setActive(index);
                      reach(h.id);
                    }}
                    aria-current={enhanced && active === index ? "true" : undefined}
                    className={`flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-start hover:bg-surface-2 ${enhanced && active === index ? "bg-accent/10" : ""}`}
                  >
                    <span className="flex w-full items-center gap-2 text-xs text-fg-muted">
                      <bdi className="min-w-0 flex-1 truncate">{h.authorName}</bdi>
                      <small className="shrink-0">{whenOf(h.at)}</small>
                    </span>
                    <span className="line-clamp-2 text-sm">{h.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
