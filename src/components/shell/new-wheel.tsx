"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, FilePen, FileUp, FolderKanban, Layers, MessageCircle, Plus, SquareCheck, UserPlus, X, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/lib/api-client";
import { browserStore } from "@/lib/guide/storage";
import { NEW_HREF, NEW_LAST_KEY, orderByLastUsed, type NewActionKey } from "@/lib/nav/new-actions";
import { DialogOverlay } from "@/components/ui/dialog";
import { WorkspaceCreateModal } from "@/components/create-forms";
import { NewDmDialog } from "@/components/chat/home/new-dm-dialog";
import { ORGS_QUERY_KEY, type OrgsResponse } from "./space-switcher";

const ICONS: Record<NewActionKey, LucideIcon> = {
  task: SquareCheck,
  project: FolderKanban,
  doc: FileUp,
  document: FilePen,
  message: MessageCircle,
  watch: Clapperboard,
  space: Layers,
  person: UserPlus,
};

/** True when a key press belongs to what the person is typing (a field, a contenteditable). */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function readLast(): string | null {
  try {
    return browserStore()?.getItem(NEW_LAST_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLast(key: NewActionKey): void {
  try {
    browserStore()?.setItem(NEW_LAST_KEY, key);
  } catch {
    /* blocked: the default order comes back next time */
  }
}

/**
 * «جديد» — the gold button of the top bar and what it opens («نجمة وطريق»).
 *
 *   computer (sm and up)   a gold WHEEL under the button: the person's actions on a ring, the question
 *                          «شو بدك تضيف؟» in its hollow centre. It hangs from the END side (the left in
 *                          Arabic), where the button is: `end-4`, never a centring translate (in RTL a
 *                          `start-1/2` plus `-translate-x-1/2` pushes it off the screen — GLM's #3).
 *   phone                  a bottom sheet: the same actions as a 3 × 2 grid, thumb-sized, over the
 *                          home-indicator inset.
 *
 * It is a Radix dialog (the app's own `Dialog` building blocks): focus is trapped and handed back to
 * the button, Escape and a tap outside close it, Tab walks the actions. The arrow keys move round the
 * ring and 1-9 start an action. «n» opens it from anywhere that is not a field.
 *
 * Every action opens something that exists (src/lib/nav/new-actions.ts): a page's own form through
 * `?new=`, or — «رسالة», «مساحة» — the existing dialog, in place, once the wheel has closed (so that
 * dialog, too, gives focus back to the button). The last action used comes first next time (this device).
 *
 * `actions` comes from the server (`newActionsFor`); with none, nothing is drawn. `defaultOpen` and
 * `portal={false}` are for server-render tests.
 */
export function NewWheel({ actions, defaultOpen = false, portal = true }: { actions: readonly NewActionKey[]; defaultOpen?: boolean; portal?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [ordered, setOrdered] = useState<NewActionKey[]>(() => [...actions]);
  const [inPlace, setInPlace] = useState<"message" | "space" | null>(null);
  const pending = useRef<"message" | "space" | null>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  const wantsSpaces = actions.includes("space");
  const orgs = useQuery({
    queryKey: ORGS_QUERY_KEY,
    queryFn: () => apiGet<OrgsResponse>("/api/workspaces"),
    retry: false,
    enabled: wantsSpaces,
  });

  // the stored order is read in the browser only, after the first paint (the server knows nothing of it)
  useEffect(() => {
    setOrdered(orderByLastUsed(actions, readLast()));
  }, [actions, open]);

  // «n» from anywhere that is not a field
  useEffect(() => {
    if (actions.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "n" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return; // another dialog is open: leave it alone
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actions.length]);

  if (actions.length === 0) return null;

  function start(key: NewActionKey) {
    writeLast(key);
    const href = NEW_HREF[key];
    if (href) {
      setOpen(false);
      router.push(href);
      return;
    }
    pending.current = key === "message" ? "message" : "space";
    setOpen(false);
  }

  function onListKey(event: ReactKeyboardEvent<HTMLUListElement>) {
    const n = ordered.length;
    const at = items.current.findIndex((el) => el === document.activeElement);
    const move = (to: number) => {
      event.preventDefault();
      items.current[((to % n) + n) % n]?.focus();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") move(at + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowRight") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(n - 1);
    else if (/^[1-9]$/.test(event.key) && Number(event.key) <= n) {
      event.preventDefault();
      start(ordered[Number(event.key) - 1]!);
    }
  }

  const content = (
    <>
      <DialogOverlay />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onCloseAutoFocus={() => {
          // Radix hands focus back to the button first; a dialog opened now remembers that button
          const next = pending.current;
          pending.current = null;
          if (next) setInPlace(next);
        }}
        style={{ "--n": ordered.length } as CSSProperties}
        className="zk-pop fixed start-0 end-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface-1 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 text-fg shadow-lg focus:outline-none sm:start-auto sm:bottom-auto sm:end-4 sm:top-[4.25rem] sm:size-[330px] sm:rounded-full sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"
      >
        <div aria-hidden="true" className="zk-wheel-ring absolute inset-0 hidden sm:block" />
        <div className="mb-3 pe-12 sm:pointer-events-none sm:absolute sm:inset-0 sm:m-auto sm:grid sm:h-fit sm:w-[118px] sm:place-items-center sm:pe-0 sm:text-center">
          <DialogPrimitive.Title className="font-display text-base font-semibold leading-6 text-fg">{t("shell.new.title")}</DialogPrimitive.Title>
          <p className="hidden text-xs text-fg-muted sm:block">{t("shell.new.close_hint")}</p>
        </div>
        <ul onKeyDown={onListKey} className="grid grid-cols-3 gap-2 sm:contents">
          {ordered.map((key, index) => {
            const Icon = ICONS[key];
            return (
              <li key={key} className="sm:contents">
                <button
                  ref={(el) => {
                    items.current[index] = el;
                  }}
                  type="button"
                  onClick={() => start(key)}
                  aria-keyshortcuts={String(index + 1)}
                  style={{ "--i": index } as CSSProperties}
                  className="zk-wheel-item flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 text-sm font-semibold text-fg transition-colors hover:bg-accent-2 hover:text-scrim focus-visible:bg-accent-2 focus-visible:text-scrim sm:size-[84px] sm:min-h-0 sm:rounded-full sm:bg-surface-1"
                >
                  <Icon aria-hidden="true" className="size-6" />
                  {t(`shell.new.${key}`)}
                </button>
              </li>
            );
          })}
        </ul>
        <DialogPrimitive.Close
          aria-label={t("ui.close")}
          className="absolute end-2 top-2 grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:end-1 sm:top-1 sm:bg-surface-2"
        >
          <X aria-hidden="true" className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </>
  );

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            data-tour="new"
            aria-keyshortcuts="N"
            aria-label={t("shell.new.open")}
            className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent-2 text-sm font-bold text-scrim transition-[filter] hover:brightness-110 sm:w-auto sm:px-4"
          >
            <Plus aria-hidden="true" className="size-5" strokeWidth={2.4} />
            <span aria-hidden="true" className="hidden sm:inline">
              {t("shell.new")}
            </span>
          </button>
        </DialogPrimitive.Trigger>
        {portal ? <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal> : open ? content : null}
      </DialogPrimitive.Root>

      {actions.includes("message") ? <NewDmDialog open={inPlace === "message"} onOpenChange={(next) => setInPlace(next ? "message" : null)} /> : null}
      {wantsSpaces ? (
        <WorkspaceCreateModal
          open={inPlace === "space"}
          onClose={() => setInPlace(null)}
          organizations={(orgs.data?.organizations ?? []).map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))}
        />
      ) : null}
    </>
  );
}
