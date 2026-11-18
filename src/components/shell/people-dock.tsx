"use client";

import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { arabicPlural } from "@/lib/format";
import { lastSeenLabel } from "@/lib/last-seen";
import { cn } from "@/lib/utils";
import { frameDrivenQuery, useFrameRefresh } from "@/lib/realtime/live-refresh";
import { Avatar } from "@/components/ui/avatar";

/** What `GET /api/presence` answers (src/server/services/presence-roster.ts). */
export interface PresencePersonDto {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  online: boolean;
  avatarUrl?: string | null;
  /** «آخر ظهور»: an ISO time, null (unknown or hidden), or absent (the switch is off / a guest): then the old «غير متصل» stays */
  lastSeenAt?: string | null;
}

export interface PresenceRosterDto {
  /** the company's zone, so «اليوم» and «أمس» are the company's days; present only with «آخر ظهور» */
  timeZone?: string;
  /** only the owner may choose between his space and the whole company */
  canChooseScope?: boolean;
  scope?: "space" | "company";
  /** who is looking: their own row is a link to their profile, never a chat with themselves */
  meId?: string;
  people: PresencePersonDto[];
  onlineCount: number;
  total: number;
}

/**
 * THE PEOPLE DOCK — the company's staff along the bottom of the shell, each with a green dot when
 * they are at their screen (the owner's ask, 2026-10-29). A strip of the online faces and one
 * counted line; a tap opens the whole roster, online first, the rest dimmed. It reads the same
 * presence the chat's member pills read (`/api/presence` -> presence.ts), so the two never disagree.
 *
 * C1.3 / F1.5 — it no longer polls every 30 s: the hub sends `presence.changed` (a frame with no id and no person) when somebody's first
 * stream opens or their last one closes, and the dock asks `/api/presence` again (folded into one request per second). What is left is
 * the safety net: one refetch every five minutes, and one on a refetch signal (a reconnect, a resume).
 *
 * A row in the shell's content column, not a floating layer: it takes its own 40px and covers no
 * page — the composer of a conversation and the end of a long list stay whole. `enabled` is false
 * for a guest (the roster is the staff directory, and a guest never sees it), and the dock draws
 * nothing at all when the answer is empty.
 *
 * `defaultOpen` is for server-render tests.
 */
export function PeopleDock({ enabled = true, defaultOpen = false }: { enabled?: boolean; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [opening, setOpening] = useState<string | null>(null);
  const [chatError, setChatError] = useState("");
  // the owner may look at the whole company; everybody else always sees the people of their space
  const [scope, setScope] = useState<"space" | "company">("space");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();

  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["presence-dock", scope],
    queryFn: () => apiGet<PresenceRosterDto>(scope === "company" ? "/api/presence?scope=company" : "/api/presence"),
    ...frameDrivenQuery(),
    enabled,
  });
  useFrameRefresh({ enabled, presence: true, delayMs: 1000, onRefresh: () => void qc.invalidateQueries({ queryKey: ["presence-dock"] }) });

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // choosing somebody opens the private chat with them, in the space I am in (the server decides who may)
  async function openChat(userId: string) {
    setOpening(userId);
    setChatError("");
    try {
      const made = await apiPost<{ id: string }>("/api/chat/dm", { userId });
      setOpen(false);
      router.push(`/chat/${made.id}`);
    } catch (err) {
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "";
      setChatError(key && t(key) !== key ? t(key) : t("shell.dock.chat_failed"));
    } finally {
      setOpening(null);
    }
  }

  const meId = enabled ? query.data?.meId : undefined;
  const people = enabled ? (query.data?.people ?? []) : [];
  const online = people.filter((p) => p.online);
  // nothing to show (a refusal, an empty company, a guest): the dock takes no room at all
  if (people.length === 0) return null;

  const faces = online.slice(0, 4);
  const extra = online.length - faces.length;
  const onlineText = t(`shell.dock.online.${arabicPlural(online.length)}`, { n: online.length });

  return (
    <div ref={rootRef} className="relative flex h-10 shrink-0 items-center gap-2 border-t border-border bg-surface-1/60 px-2">
      {open ? (
        <section
          id={panelId}
          aria-labelledby={headingId}
          className="absolute bottom-full start-2 z-40 mb-1 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-lg animate-fade-in motion-reduce:animate-none"
        >
          <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border pe-3 ps-4">
            <h2 id={headingId} className="font-sans text-sm font-semibold text-fg">
              {t("shell.dock.title")}
            </h2>
            <span className="text-xs text-fg-muted">{onlineText}</span>
          </div>
          {query.data?.canChooseScope ? (
            <div role="group" aria-label={t("shell.dock.scope")} className="flex gap-1 border-b border-border px-3 py-2">
              {(["space", "company"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-dock-scope={value}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                  className={cn("min-h-9 flex-1 rounded-lg border px-2 text-xs font-semibold", scope === value ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:bg-surface-2")}
                >
                  {t(value === "space" ? "shell.dock.scope_space" : "shell.dock.scope_company")}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain">
            {people.map((p) => (
              <li key={p.userId} className="border-b border-border last:border-0">
                <Row
                  mine={p.userId === meId}
                  person={p}
                  busy={opening === p.userId}
                  chatLabel={t("shell.dock.chat_with", { name: p.name })}
                  onChat={() => void openChat(p.userId)}
                >
                <span className="relative shrink-0">
                  <Avatar name={p.name} src={p.avatarUrl} className={cn("size-9", !p.online && "opacity-60")} />
                  {p.online ? (
                    <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-surface-1 bg-ok" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-semibold", !p.online && "text-fg-muted")}>{p.name}</span>
                  <span className="block truncate text-xs text-fg-muted">{p.jobTitle ?? t("shell.dock.no_title")}</span>
                </span>
                <span data-last-seen className={cn("max-w-[8.5rem] shrink-0 text-end text-xs leading-tight", p.online ? "font-semibold text-ok" : "text-fg-muted")}>
                  {lastSeenLabel(p, { timeZone: query.data?.timeZone }) ?? (p.online ? t("shell.dock.online_now") : t("shell.dock.offline"))}
                </span>
                </Row>
              </li>
            ))}
          </ul>
          {chatError ? (
            <p role="alert" className="border-t border-border px-3 py-2 text-xs text-danger">
              {chatError}
            </p>
          ) : null}
        </section>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={online.length > 0 ? onlineText : t("shell.dock.title")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-w-0 items-center gap-2 rounded-full px-1 text-xs font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        {faces.length > 0 ? (
          <span aria-hidden="true" className="flex items-center">
            {faces.map((p, i) => (
              <span key={p.userId} className={cn("relative", i > 0 && "-ms-2")} style={{ zIndex: faces.length - i }}>
                <Avatar name={p.name} src={p.avatarUrl} className="size-6 ring-2 ring-surface-1" />
                <span className="absolute -bottom-0.5 -end-0.5 size-2 rounded-full border border-surface-1 bg-ok" />
              </span>
            ))}
            {extra > 0 ? (
              <span className="-ms-2 grid size-6 place-items-center rounded-full bg-surface-2 text-xs font-bold text-fg-muted ring-2 ring-surface-1">
                {extra > 9 ? "9+" : extra}
              </span>
            ) : null}
          </span>
        ) : (
          <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-surface-2 text-fg-muted">
            <Users className="size-3.5" />
          </span>
        )}
        <span className="truncate pe-1">{online.length > 0 ? onlineText : t("shell.dock.title")}</span>
      </button>
    </div>
  );
}

const rowClass = "flex w-full items-center gap-3 px-3 py-2 text-start";

/** One person of the roster: me, a link to my profile; anybody else, a button that opens a private chat with them. */
function Row({ mine, person, busy, chatLabel, onChat, children }: { mine: boolean; person: PresencePersonDto; busy: boolean; chatLabel: string; onChat: () => void; children: React.ReactNode }) {
  if (mine) {
    return (
      <Link href={`/u/${encodeURIComponent(person.userId)}`} className={cn(rowClass, "hover:bg-surface-2")}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" data-dock-chat={person.userId} aria-label={chatLabel} disabled={busy} onClick={onChat} className={cn(rowClass, "min-h-11 hover:bg-surface-2 disabled:opacity-60")}>
      {children}
    </button>
  );
}
