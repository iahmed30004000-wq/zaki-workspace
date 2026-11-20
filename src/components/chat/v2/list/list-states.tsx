"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import type { ListFolderKey } from "@/lib/chat/list-folders";

/** C2.2 — what the list says when it has no rows to draw: loading, a failed load, or an empty folder (never an empty list for one that has not arrived). */

export function ListSkeleton({ tall }: { tall: boolean }) {
  return (
    <div role="status" aria-label={ct("chath.loading")} data-chat-loading="" className="flex-1 overflow-hidden">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-3 border-b border-border/60 px-3" style={{ height: tall ? 76 : 72 }}>
          <div className="size-12 shrink-0 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="m-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
      {ct("chath.load_failed")}{" "}
      <button type="button" onClick={onRetry} className="min-h-11 underline">
        {ct("chath.retry")}
      </button>
    </div>
  );
}

export function ListEmpty({
  folder,
  query,
  onCreateSpace,
}: {
  /** a built-in folder, or `custom` for one of the person's own (C3a.2) */
  folder: ListFolderKey | "custom";
  /** the words typed in the search field (empty: none) */
  query: string;
  /** shown only where the person may open a space and has none at all */
  onCreateSpace?: () => void;
}) {
  if (query) {
    return (
      <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
        {ct("chatui.empty.search", { query })}
      </p>
    );
  }
  if (folder === "all") {
    return (
      <div className="px-4 py-6 text-center text-sm text-fg-muted">
        <p role="status">{ct("chath.no_spaces")}</p>
        {onCreateSpace ? (
          <Button type="button" onClick={onCreateSpace} className="mt-3">
            {ct("chath.new_space")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
      {ct(`chatui.empty.${folder}`)}
    </p>
  );
}
