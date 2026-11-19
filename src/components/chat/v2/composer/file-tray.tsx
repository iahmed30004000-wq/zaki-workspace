"use client";

import React from "react";
import { ct } from "@/lib/chat/text";
import type { PendingFile } from "@/lib/chat/v2/composer/types";
import { ALBUM_MAX } from "@/lib/chat/album-layout";

/**
 * C2.5 — the files waiting under the box: a thumbnail (a name for a plain file), the × that takes one away, and the upload's own progress bar while sending.
 * C3b.3: with two or more, a line says how many of the ten are in and that they go as ONE message with ONE caption (the box above is the caption).
 */
export function FileTray({ files, busy, progress, onRemove }: { files: PendingFile[]; busy: boolean; progress: number[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ul data-file-tray className="flex flex-wrap gap-2" aria-label={ct("chatc.attach")}>
        {files.map((item, index) => (
          <li key={`${item.file.name}-${index}`} data-tray-kind={item.asFile ? "FILE" : item.kind} className="relative flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-1 text-xs">
            {item.kind === "IMAGE" && item.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing for next/image to optimise
              <img src={item.preview} alt={item.file.name} className="size-full object-cover" />
            ) : item.kind === "VIDEO" && item.preview ? (
              <video src={item.preview} muted preload="metadata" className="size-full object-cover" aria-label={item.file.name} />
            ) : (
              <span className="line-clamp-3 break-all p-1 text-center">{item.file.name}</span>
            )}
            {!busy ? (
              <button type="button" className="absolute end-0 top-0 flex size-6 items-center justify-center rounded-full bg-surface text-fg shadow" aria-label={ct("chat.f.remove", { name: item.file.name })} onClick={() => onRemove(index)}>
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {busy && progress[index] !== undefined ? (
              <span className="absolute inset-x-0 bottom-0 h-1 bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress[index]} aria-label={ct("chat.f.progress", { name: item.file.name, percent: progress[index] ?? 0 })}>
                <span className="block h-full bg-accent" style={{ width: `${progress[index]}%` }} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {files.length >= 2 ? (
        <p data-tray-count className="text-xs text-fg-muted" aria-live="polite">
          {ct("chatalb.tray_count", { count: files.length, max: ALBUM_MAX })}
        </p>
      ) : null}
    </div>
  );
}
