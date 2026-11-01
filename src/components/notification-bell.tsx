"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtAgo } from "@/lib/format";
import { ensurePush, pushState, type PushState } from "@/components/calls/push-client";
import { pollMs } from "@/lib/economy";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

/**
 * The bell in the top bar, and the guide's «inbox» stop. It polls every 30 s (push notifications come in
 * Phase 5) and opens a panel of the latest notifications: tap one to go to it, mark it read, delete it.
 *
 * The panel fits a 375px phone: pinned 8px from both edges right under the top bar (never wider than the
 * screen), and from `md` it hangs under the bell. A tap outside or Escape closes it (Escape gives focus back
 * to the bell). The row actions show on a phone, where there is no hover, and are 44px targets.
 *
 * `defaultOpen` is for server-render tests.
 */
export function NotificationBell({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications"),
    refetchInterval: pollMs(30_000),
  });

  const markAll = useMutation({
    mutationFn: () => apiPost("/api/notifications/read", { all: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiPost("/api/notifications/read", { ids: [id] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // while open: a tap anywhere else closes the panel; Escape closes it and gives focus back to the bell
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

  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

  return (
    <div ref={rootRef} data-tour="inbox" className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread > 0 ? t("shell.inbox_unread", { count: unread }) : t("notif.title")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset md:hover:bg-transparent md:hover:text-fg-muted md:hover:[@media(hover:hover)]:bg-surface-2 md:hover:[@media(hover:hover)]:text-fg"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold leading-none text-danger-fg"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          id={panelId}
          aria-labelledby={headingId}
          className="fixed end-2 start-2 top-[calc(3.5rem+0.25rem+env(safe-area-inset-top))] z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-lg animate-fade-in motion-reduce:animate-none md:absolute md:end-0 md:start-auto md:top-12 md:w-80"
        >
          <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border pe-1 ps-4">
            <h2 id={headingId} className="font-sans text-sm font-semibold text-fg">
              {t("notif.title")}
            </h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="min-h-11 rounded-lg px-3 text-xs font-medium text-accent transition-colors hover:bg-surface-2"
              >
                {t("notif.markAll")}
              </button>
            ) : null}
          </div>
          <PushOffer />
          <ul className="max-h-[min(20rem,60dvh)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted">{t("notif.empty")}</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className={cn("border-b border-border last:border-0", !n.readAt && "bg-accent/5")}>
                  <div className="group flex items-start">
                    <div className="min-w-0 flex-1">
                      {n.linkUrl ? (
                        <Link
                          href={n.linkUrl}
                          onClick={() => {
                            setOpen(false);
                            if (!n.readAt) markOne.mutate(n.id);
                          }}
                          className="block py-3 pe-1 ps-4 transition-colors hover:bg-surface-2/60"
                        >
                          <NotificationRow n={n} />
                        </Link>
                      ) : (
                        <div className="py-3 pe-1 ps-4">
                          <NotificationRow n={n} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center transition-opacity md:[@media(hover:hover)]:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      {!n.readAt ? (
                        <button
                          type="button"
                          aria-label={t("notif.markRead")}
                          onClick={() => markOne.mutate(n.id)}
                          className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                        >
                          <Check aria-hidden="true" className="size-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={t("notif.delete")}
                        onClick={() => del.mutate(n.id)}
                        className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("truncate text-sm text-fg", !n.readAt && "font-semibold")}><bdi>{n.title}</bdi></p>
        <p className="shrink-0 text-xs text-muted">{fmtAgo(n.createdAt)}</p>
      </div>
      {n.body ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-muted">{n.body}</p> : null}
    </>
  );
}

/**
 * «فعّل الإشعارات على هالجهاز»: the bell's notifications then reach this phone or laptop while the site is closed
 * (src/server/notify.ts). Shown only while the browser has not been asked yet; the browser asks on the tap itself.
 * Refused in the browser's settings: one line on where to turn it back on. An iPhone needs the site on its home screen.
 */
function PushOffer() {
  const { t } = useI18n();
  const [state, setState] = useState<PushState>("unsupported");
  useEffect(() => setState(pushState()), []);
  if (state === "granted" || state === "unsupported") return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent/5 px-4 py-2 text-xs leading-5 text-fg">
      {state === "denied" ? (
        <p className="flex-1 text-muted">{t("notif.push_denied")}</p>
      ) : (
        <>
          <p className="flex-1">{state === "ios_home" ? t("notif.push_ios") : t("notif.push_offer")}</p>
          {state === "default" ? (
            <button
              type="button"
              onClick={() => void ensurePush(true).then(() => setState(pushState()))}
              className="min-h-11 shrink-0 rounded-lg bg-accent px-3 font-semibold text-accent-fg"
            >
              {t("notif.push_on")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
