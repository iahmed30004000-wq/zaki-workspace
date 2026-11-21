"use client";

import * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type ToastKind = "success" | "error" | "info";

/** S5.2: an optional button inside the toast («افتح»): pressing it runs `onClick` and closes the toast. Nothing else about a toast changes. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

let seq = 0;

/** How long a toast stays up when the pointer is nowhere near it. */
export const TOAST_DISMISS_MS = 4000;
/** A toast that carries a button («افتح») stays longer: there must be time to reach it. */
export const TOAST_ACTION_DISMISS_MS = 8000;

/**
 * App-wide toasts. All mutations should surface results through this.
 *
 * Where they appear: at the TOP of the screen on phones, below the notch (safe-area inset) and
 * below the 56px top bar, so a toast never covers the bottom bar or the bottom of a sheet; in the
 * bottom CENTRE from the `md` breakpoint (768px), as in the owner's mock-up. The toast itself is the mock-up's dark pill: the ink (`fg`) with
 * the page colour as its text on the light themes, `surface-2` with the normal text on the dark ones — never a white card. (`scrim` is the dimming layer
 * behind a dialog and nothing else: tests/ui-tokens.test.ts.) The stack is a polite
 * live region: `aria-live` is also what keeps it announced while a dialog hides the rest of the
 * page from screen readers.
 *
 * WCAG 2.2.1: the auto-dismiss timer pauses while a toast is hovered or focused, so a slow reader
 * is never raced by the clock; the timer restarts from the full 4 s when the pointer leaves.
 *
 * A tap on a toast must not fall through to the dialog/sheet beneath it: the row carries
 * `data-zk-toast`, and DialogPanel/SheetPanel ignore interactions from inside it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info", action?: ToastAction) => {
    const id = ++seq;
    setItems((prev) => [...prev.slice(-4), { id, kind, message, ...(action ? { action } : {}) }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed end-0 start-0 top-14 z-[70] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:bottom-6 md:top-auto md:p-0"
      >
        {items.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={() => setItems((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { t } = useI18n();
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused) return; // hover/focus holds the clock still (WCAG 2.2.1)
    const timer = window.setTimeout(onDismiss, item.action ? TOAST_ACTION_DISMISS_MS : TOAST_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [paused, onDismiss, item.action]);

  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden="true" />,
    error: <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden="true" />,
    info: <Info className="size-4 shrink-0 text-accent" aria-hidden="true" />,
  };
  return (
    <div
      role="status"
      data-zk-toast=""
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl bg-fg ps-3 text-surface shadow-lg dark:bg-surface-2 dark:text-fg animate-fade-in motion-reduce:animate-none md:w-auto md:min-w-64 md:max-w-md",
      )}
    >
      {icons[item.kind]}
      <p className="min-w-0 flex-1 py-3 text-sm">{item.message}</p>
      {item.action ? (
        <button
          type="button"
          data-toast-action=""
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          className="flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold underline underline-offset-4 hover:opacity-80"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("ui.toast_close")}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast requires ToastProvider");
  return ctx;
}

/** The toast API when a ToastProvider is above, else null (a screen that is also rendered on its own, in a test). */
export function useOptionalToast(): ToastApi | null {
  return useContext(ToastCtx);
}
