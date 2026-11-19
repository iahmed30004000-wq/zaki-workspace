"use client";

import React from "react";
import { useI18n } from "@/lib/i18n";
import { ct } from "@/lib/chat/text";
import { SAVED_SHORTCUT, SETTINGS_SHORTCUT, SHORTCUT_ROWS } from "@/lib/chat/shortcuts";

/**
 * C4.1 — «الاختصارات»: the table of C2 §8, read-only, drawn from the same registry the keyboard module uses (`SHORTCUT_ROWS`, plus the two keys that are not
 * rows of the chat sheet: Ctrl+0 for «المحفوظة» and Ctrl+, for this screen). ⚠️ Only «Ctrl» and «Esc» may be Latin on screen; every other key is an Arabic name or a symbol.
 */
const cap = "inline-flex min-w-7 items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-fg";

function KeyCap({ name }: { name: string }) {
  switch (name) {
    case "ctrl":
      return <kbd className={cap}>Ctrl</kbd>;
    case "esc":
      return <kbd className={cap}>Esc</kbd>;
    case "alt":
      return <kbd className={cap}>{ct("chatui.keys.alt")}</kbd>;
    case "shift":
      return <kbd className={cap}>{ct("chatui.keys.shift")}</kbd>;
    case "up":
      return <kbd className={cap}>↑</kbd>;
    case "down":
      return <kbd className={cap}>↓</kbd>;
    case "digits":
      return <kbd className={cap}>1 … 9</kbd>;
    case "comma":
      return <kbd className={cap}>,</kbd>;
    case "question":
      return <kbd className={cap}>?</kbd>;
    default:
      return <kbd className={cap}>{name.toUpperCase()}</kbd>;
  }
}

interface Row {
  id: string;
  keys: readonly string[];
  labelKey: string;
}

export function ShortcutsSection() {
  const { t } = useI18n();
  const rows: Row[] = [SETTINGS_SHORTCUT, SAVED_SHORTCUT, ...SHORTCUT_ROWS];
  return (
    <div data-section-body="shortcuts">
      <p className="px-3 pb-3 text-[13px] text-fg-muted md:px-0">{t("settingsMe.k.intro")}</p>
      <ul data-shortcuts className="divide-y divide-border border-y border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 md:px-1">
            <span className="min-w-0 flex-1 text-sm">{ct(row.labelKey)}</span>
            <span dir="ltr" className="flex shrink-0 items-center gap-1">
              {row.keys.map((name, index) => (
                <React.Fragment key={name}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-xs text-fg-muted">
                      +
                    </span>
                  ) : null}
                  <KeyCap name={name} />
                </React.Fragment>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
