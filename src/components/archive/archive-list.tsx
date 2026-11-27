import React from "react";
import type { ArchiveItemDto } from "@/server/chat/dto";
import { AR } from "@/lib/i18n/dict";
import { fmtDateTime } from "@/lib/format";

function stamp(value?: string | null) {
  return fmtDateTime(value);
}

export function ArchiveList({ items }: { items: ArchiveItemDto[] }) {
  if (!items.length) return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-fg-muted">{AR["archive.empty"]}</p>;
  return <ol className="space-y-3" aria-label={AR["archive.records"]}>
    {items.map((item) => <li key={`${item.type}:${item.id}`} className="rounded-[14px] bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent">{AR[`archive.type.${item.type}`]}</span>
        <time className="text-xs text-fg-muted" dateTime={item.at ?? undefined}>{stamp(item.at)}</time>
      </div>
      <p className="mt-2 text-xs text-fg-muted">{item.spaceName ?? AR["archive.noSpace"]}</p>
      {item.type === "deleted" && <div className="mt-3 space-y-2">
        <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{item.body || AR["archive.noBody"]}</p>
        <p className="text-xs text-fg-muted">{AR["archive.author"]}: {item.authorName || AR["archive.unknown"]}</p>
        <p className="text-xs text-fg-muted">{AR["archive.deletedBy"]}: {item.deletedByName || AR["archive.unknown"]} · {stamp(item.deletedAt)}</p>
      </div>}
      {item.type === "edited" && <div className="mt-3 space-y-2 text-sm">
        <p className="text-xs text-fg-muted">{AR["archive.author"]}: {item.authorName || AR["archive.unknown"]}</p>
        <p className="rounded-lg bg-surface-2 p-3"><span className="text-xs text-fg-muted">{AR["archive.before"]}: </span>{item.previousBody || AR["archive.noBody"]}</p>
        <p className="rounded-lg border border-border p-3"><span className="text-xs text-fg-muted">{AR["archive.after"]}: </span>{item.body || AR["archive.noBody"]}</p>
        {item.oldFiles?.length ? <div data-archive-old-files="" className="space-y-1">
          <p className="text-xs text-fg-muted">{AR["tgx.archive.old_files"]}</p>
          <ul className="flex flex-col">{item.oldFiles.map((file) => <li key={file.id}><a href={file.url} download={file.name} dir="auto" className="inline-flex min-h-11 items-center text-accent underline [overflow-wrap:anywhere]">{file.name}</a></li>)}</ul>
        </div> : null}
      </div>}
      {item.type === "moderation" && <div className="mt-3 space-y-1 text-sm">
        <p>{AR["archive.action"]}: {item.action ?? AR["archive.unknown"]}</p>
        <p className="text-xs text-fg-muted">{AR["archive.actor"]}: {item.actorName || AR["archive.unknown"]}{item.targetName ? ` · ${AR["archive.target"]}: ${item.targetName}` : ""}</p>
      </div>}
      {item.type === "closed" && <p className="mt-3 text-sm font-medium">🔒 {AR["archive.closedTopic"]}: {item.title || AR["archive.unknown"]}</p>}
    </li>)}
  </ol>;
}
