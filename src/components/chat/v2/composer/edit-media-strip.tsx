"use client";

import React from "react";
import { FileText, RefreshCw, Undo2 } from "lucide-react";
import type { AttachmentDto } from "@/server/chat/dto";
import { safeMediaUrl } from "@/lib/chat/album-layout";
import { ct } from "@/lib/chat/text";
import type { MediaReplacement } from "@/lib/chat/v2/composer/types";

/**
 * «تعديل صورة أو ملف» — over the box while my own message with files is being edited: one row per file, each with «استبدل». ONE file is replaced per save (choosing
 * another moves the choice), and «تراجع» takes it back. Nothing is uploaded until «حفظ». The old file is not deleted (the server keeps it with the edit history).
 */
export function EditMediaStrip({ attachments, replacement, busy, onReplace }: { attachments: AttachmentDto[]; replacement: MediaReplacement | null; busy: boolean; onReplace: (next: MediaReplacement | null) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const target = React.useRef<string>("");
  return (
    <div data-edit-media="" className="rounded-xl bg-surface-1 px-3 py-2 shadow-card">
      <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
        {attachments.map((file) => {
          const chosen = replacement?.attachmentId === file.id ? replacement.file : null;
          const url = !chosen && file.kind === "IMAGE" ? safeMediaUrl(file.url) : undefined;
          return (
            <li key={file.id} data-edit-media-row={file.id} className="flex min-h-11 items-center gap-2">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked), a small thumbnail
                <img src={url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2">
                  <FileText className="size-5 text-fg-muted" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-sm">
                  {chosen ? chosen.name : file.name}
                </span>
                {chosen ? <span className="block text-xs text-accent">{ct("tgx.media.new_file")}</span> : null}
              </span>
              {chosen ? (
                <button type="button" data-edit-media-undo="" disabled={busy} aria-label={ct("tgx.media.undo")} onClick={() => onReplace(null)} className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2">
                  <Undo2 aria-hidden="true" className="size-5" />
                </button>
              ) : null}
              <button
                type="button"
                data-edit-media-replace={file.id}
                disabled={busy}
                onClick={() => {
                  target.current = file.id;
                  input.current?.click();
                }}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-surface-2 disabled:opacity-60"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                {ct("tgx.media.replace")}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="pt-1 text-xs text-fg-muted">{ct("tgx.media.hint")}</p>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file && target.current) onReplace({ attachmentId: target.current, file });
        }}
      />
    </div>
  );
}
