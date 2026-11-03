"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, ExternalLink, MessageCircle, Search, Send, UserRound, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtTime } from "@/lib/format";
import { lastSeenLabel } from "@/lib/last-seen";
import { cn } from "@/lib/utils";
import { foldedIncludes } from "@/lib/search/arabic";
import { Avatar } from "@/components/ui/avatar";
import { CallButton } from "@/components/calls/call-button";
import { AssistantRow } from "@/components/chat/assistant-row";

/** One row of `GET /api/chat/directory?scope=company` (src/server/chat/directory.ts). */
export interface QuickChatPersonDto {
  userId: string;
  role: string;
  /** One of the people of the space the viewer is in: a private message can be opened with them. */
  inSpace: boolean;
  online: boolean;
  /** «آخر ظهور»: an ISO time, null (unknown or hidden), or absent (the switch is off / a guest): then the old «غير موجود» stays */
  lastSeenAt?: string | null;
  user: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null };
}

export interface QuickChatPeopleDto {
  /** «المساعد» is offered as the first name of the list (its switch is on and «@المساعد» is on). */
  assistant?: boolean;
  /** the company's zone, so «اليوم» and «أمس» are the company's days; present only with «آخر ظهور» */
  timeZone?: string;
  people: QuickChatPersonDto[];
}

/** The part of the conversation the little window draws. */
export interface QuickChatMessageDto {
  id: string;
  body: string | null;
  deleted: boolean;
  mine: boolean;
  authorName: string;
  authorAvatar?: string | null;
  createdAt: string;
}

export interface QuickChatConversationDto {
  id: string;
  me: { canPost: boolean; canCall?: boolean };
  /** false when the company switched calls off (the same field the chat page reads) */
  calls?: boolean;
  messages: QuickChatMessageDto[];
}

/**
 * THE QUICK CHAT — the round button in the corner of the shell (the owner's ask, 2026-10-30: «اريد على
 * خانة اليسار تحت يكون في خيار اسمه الدردشة … وبس تضغط على عضو تفتح خانة الدردشة وتكون خانة عائمة»).
 *
 * «اليسار تحت» is the PHYSICAL left, so the corner is `end-3` / `items-end`: the same corner the call's
 * mini window takes (`call-provider.tsx`). In an RTL screen `start` would put it on the right, where the
 * owner did not ask for it.
 *
 * One tap opens the company's people (the staff roster, online first: `?scope=company` on the
 * directory route); one tap on a person opens the same DM the chat page opens (`POST /api/chat/dm`),
 * here, without leaving the page. It writes through the chat's own doors — no second inbox, no second
 * table — so a message sent here is the very message the chat page shows, and the other side's answer
 * arrives with the same 4 s poll.
 *
 * A person of another space is still listed (the list is the company, the owner's choice) but marked
 * and not clickable: a DM lives inside the space (`chat.dm_not_in_space`), so a button that only ever
 * refuses is worse than a name that says why.
 *
 * Theme tokens only (`bg-surface-1`, `text-fg`, `bg-accent`…), logical CSS only, no new dependency:
 * the movement is CSS.
 *
 * `defaultOpen` is for server-render tests.
 */
export function QuickChat({ enabled = true, defaultOpen = false }: { enabled?: boolean; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [peer, setPeer] = useState<QuickChatPersonDto | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const peopleQuery = useQuery({
    queryKey: ["quick-chat-people"],
    queryFn: () => apiGet<QuickChatPeopleDto>("/api/chat/directory?scope=company"),
    enabled: enabled && open,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const conversationQuery = useQuery({
    queryKey: ["quick-chat-dm", conversationId],
    queryFn: () => apiGet<QuickChatConversationDto>(`/api/chat/conversations/${conversationId}?limit=30`),
    enabled: enabled && open && Boolean(conversationId),
    refetchInterval: 4_000,
  });

  const openDm = useMutation({
    mutationFn: (userId: string) => apiPost<{ id: string; created: boolean }>("/api/chat/dm", { userId }),
  });
  const send = useMutation({
    mutationFn: (vars: { id: string; body: string }) => apiPost<{ id: string }>(`/api/chat/conversations/${vars.id}/messages`, { body: vars.body }),
  });

  function close() {
    setOpen(false);
    setPeer(null);
    setConversationId(null);
    setNotice(null);
    buttonRef.current?.focus();
  }

  function backToPeople() {
    setPeer(null);
    setConversationId(null);
    setNotice(null);
    setDraft("");
  }

  async function pick(person: QuickChatPersonDto) {
    if (!person.inSpace) {
      setNotice(t("quickChat.other_space"));
      return;
    }
    setNotice(null);
    setPeer(person);
    setOpening(true);
    try {
      const dm = await openDm.mutateAsync(person.userId);
      setConversationId(dm.id);
      // reading the window is reading the conversation: the unread badge of the chat page follows
      void apiPost<{ ok: boolean }>(`/api/chat/conversations/${dm.id}`, {}).catch(() => {});
    } catch {
      setPeer(null);
      setNotice(t("quickChat.open_failed"));
    } finally {
      setOpening(false);
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body || !conversationId) return;
    setDraft("");
    setNotice(null);
    try {
      await send.mutateAsync({ id: conversationId, body });
      await conversationQuery.refetch();
    } catch {
      setDraft(body);
      setNotice(t("quickChat.failed"));
    }
  }

  // close on Escape or a tap outside, like the people dock
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setPeer(null);
        setConversationId(null);
        setNotice(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      setPeer(null);
      setConversationId(null);
      setNotice(null);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // the first thing to type into: the person's name, or the message once a conversation is open
  useEffect(() => {
    if (!open) return;
    if (conversationId) inputRef.current?.focus();
    else searchRef.current?.focus();
  }, [open, conversationId]);

  const messageCount = conversationQuery.data?.messages.length ?? 0;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, conversationId, send.isPending]);

  if (!enabled) return null;

  const people = peopleQuery.data?.people ?? [];
  const needle = search.trim();
  const filtered = needle ? people.filter((p) => foldedIncludes(p.user.name, needle) || foldedIncludes(p.user.jobTitle ?? "", needle)) : people;
  const messages = conversationQuery.data?.messages ?? [];
  // «آخر ظهور»: null means the answer carries none (switch off, older server): each place keeps its old words
  const seenOf = (p: QuickChatPersonDto): string | null => lastSeenLabel(p, { timeZone: peopleQuery.data?.timeZone });
  // the header follows the list's fresh answer, not the snapshot taken when the person was picked
  const livePeer = peer ? (people.find((p) => p.userId === peer.userId) ?? peer) : null;

  return (
    <div
      ref={rootRef}
      className="fixed bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] end-3 z-50 flex flex-col items-end gap-2 md:bottom-5"
    >
      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-label={peer ? peer.user.name : t("quickChat.title")}
          className="flex h-[min(30rem,calc(100dvh-9rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-border bg-surface-1 shadow-2xl animate-fade-in motion-reduce:animate-none"
        >
          <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2.5">
            {peer ? (
              <>
                <button
                  type="button"
                  onClick={backToPeople}
                  aria-label={t("quickChat.back")}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ArrowRight className="size-4" />
                </button>
                <span className="relative shrink-0">
                  <Avatar name={peer.user.name} src={peer.user.avatarUrl} className="size-8" />
                  {(livePeer ?? peer).online ? (
                    <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-surface-1 bg-ok" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{peer.user.name}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {(livePeer ? seenOf(livePeer) : null) ?? ((livePeer ?? peer).online ? t("quickChat.online") : t("quickChat.offline"))}
                  </span>
                </span>
                {/* the private chat's own buttons, beside the name: a call, the whole conversation, the person's page */}
                {conversationId && conversationQuery.data && conversationQuery.data.calls !== false ? (
                  <CallButton compact conversationId={conversationId} isDm canStart={conversationQuery.data.me.canPost && conversationQuery.data.me.canCall !== false} />
                ) : null}
                {conversationId ? (
                  <Link
                    href={`/chat/${encodeURIComponent(conversationId)}`}
                    onClick={close}
                    aria-label={t("quickChat.open_full")}
                    title={t("quickChat.open_full")}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <ExternalLink className="size-4" />
                  </Link>
                ) : null}
                <Link
                  href={`/u/${encodeURIComponent(peer.userId)}`}
                  onClick={close}
                  aria-label={t("quickChat.profile")}
                  title={t("quickChat.profile")}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <UserRound className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                  <MessageCircle className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{t("quickChat.title")}</span>
                  <span className="block truncate text-xs text-fg-muted">{t("quickChat.subtitle")}</span>
                </span>
              </>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t("quickChat.close")}
              className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-4" />
            </button>
          </header>

          {notice ? (
            <p role="status" className="border-b border-border bg-warn/10 px-3 py-2 text-xs text-warn">
              {notice}
            </p>
          ) : null}

          {peer ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div ref={logRef} role="log" aria-label={t("quickChat.messages")} aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3">
                {opening || conversationQuery.isPending ? (
                  <p className="text-sm text-fg-muted">{t("quickChat.loading")}</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t("quickChat.no_messages")}</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={cn("flex w-full items-end gap-2", m.mine ? "justify-end" : "justify-start")}>
                      {m.mine ? null : <Avatar name={m.authorName} src={m.authorAvatar} className="size-7" />}
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl border px-3 py-2 text-sm text-fg",
                          m.mine ? "rounded-ee-md border-accent/30 bg-accent/10" : "rounded-es-md border-border bg-surface",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.deleted ? t("quickChat.deleted") : m.body}</p>
                        <time dateTime={m.createdAt} dir="ltr" className="mt-1 block text-end text-xs tabular-nums text-fg-muted">
                          {fmtTime(m.createdAt)}
                        </time>
                      </div>
                    </div>
                  ))
                )}
                {send.isPending ? (
                  <div aria-hidden="true" className="flex justify-end">
                    <div className="flex items-center gap-1 rounded-2xl rounded-ee-md border border-accent/30 bg-accent/10 px-3 py-2.5">
                      <span className="size-1.5 animate-bounce rounded-full bg-fg-muted" />
                      <span className="size-1.5 animate-bounce rounded-full bg-fg-muted [animation-delay:150ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-fg-muted [animation-delay:300ms]" />
                    </div>
                  </div>
                ) : null}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
                className="border-t border-border p-2"
              >
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1.5 focus-within:border-accent/50">
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={t("quickChat.placeholder")}
                    placeholder={t("quickChat.placeholder")}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || send.isPending}
                    aria-label={t("quickChat.send")}
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-surface-2 disabled:text-fg-muted"
                  >
                    <Send className="size-4" />
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border p-2">
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 focus-within:border-accent/50">
                  <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label={t("quickChat.search")}
                    placeholder={t("quickChat.search")}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                  />
                </div>
              </div>
              {peopleQuery.data?.assistant === true && (!needle || foldedIncludes(t("assistantChat.row_title"), needle)) ? <AssistantRow className="border-b border-border" onOpened={close} /> : null}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {peopleQuery.isPending ? (
                  <p className="p-3 text-sm text-fg-muted">{t("quickChat.loading")}</p>
                ) : filtered.length === 0 ? (
                  <p className="p-3 text-sm text-fg-muted">{t(people.length === 0 ? "quickChat.empty" : "quickChat.no_result")}</p>
                ) : (
                  <ul>
                    {filtered.map((person) => (
                      <li key={person.userId}>
                        <button
                          type="button"
                          onClick={() => void pick(person)}
                          aria-label={person.inSpace ? person.user.name : `${person.user.name} — ${t("quickChat.other_space_badge")}`}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                            !person.inSpace && "opacity-60",
                          )}
                        >
                          <span className="relative shrink-0">
                            <Avatar name={person.user.name} src={person.user.avatarUrl} className="size-9" />
                            {person.online ? (
                              <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-surface-1 bg-ok" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-fg">{person.user.name}</span>
                            <span className="block truncate text-xs text-fg-muted">{person.user.jobTitle ?? t("shell.dock.no_title")}</span>
                          </span>
                          {seenOf(person) !== null ? (
                            <span data-last-seen className={cn("max-w-[7rem] shrink-0 text-end text-xs leading-tight", person.online ? "font-semibold text-ok" : "text-fg-muted")}>
                              {seenOf(person)}
                            </span>
                          ) : null}
                          {person.inSpace ? null : (
                            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted">
                              {t("quickChat.other_space_badge")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("quickChat.open")}
        onClick={() => (open ? close() : setOpen(true))}
        className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:hover:scale-100"
      >
        <MessageCircle className="size-5" />
      </button>
    </div>
  );
}
