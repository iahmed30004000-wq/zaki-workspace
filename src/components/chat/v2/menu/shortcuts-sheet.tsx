"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHEET_ROWS, type KeyName } from "@/lib/chat/shortcuts";
import { ct } from "@/lib/chat/text";

/**
 * The name of a key as it is written on screen. ⚠️ Only «Ctrl» and «Esc» may be Latin (`tests/arabic-ui.test.ts` allows exactly those two key names and
 * its allow-list may not grow): the others are Arabic letters — «ألت», «شيفت» — and the arrows are ↑ ↓.
 */
function KeyCap({ name }: { name: KeyName }) {
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
    case "f":
      return <kbd className={cap}>F</kbd>;
    case "question":
      return <kbd className={cap}>?</kbd>;
    case "0":
      return <kbd className={cap}>0</kbd>;
  }
}
const cap = "inline-flex min-w-7 items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-fg";

/**
 * C2.6 — «اختصارات لوحة المفاتيح»: the sheet Ctrl+Shift+? opens. It draws the table the keyboard module registers (`SHEET_ROWS`: C2.6's eight and Ctrl+0), so a key that is
 * registered is listed and a key that is not (formatting: its own toolbar) is not. The keys read left to right inside a row (`dir="ltr"`: a key
 * combination is a sequence, not a sentence), the words are the dictionary's.
 */
export function ShortcutsSheet({ open, onOpenChange, portal = true }: { open: boolean; onOpenChange: (open: boolean) => void; portal?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent portal={portal} size="md" aria-label={ct("chatui.keys.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatui.keys.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ul data-shortcuts className="divide-y divide-border">
            {SHEET_ROWS.map((row) => (
              <li key={row.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
