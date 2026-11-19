"use client";

import React from "react";
import { createPortal } from "react-dom";
import { ct } from "@/lib/chat/text";
import { dragHasFiles } from "@/lib/chat/v2/composer/clipboard-files";

/** The two zones themselves (drawn alone by the tests). `hover`: the zone the files are over. */
export function DropZones({ hover, onZoneOver, onDropFiles }: { hover: "media" | "files" | null; onZoneOver?: (zone: "media" | "files" | null) => void; onDropFiles?: (zone: "media" | "files", files: FileList) => void }) {
  const zone = (id: "media" | "files", label: string) => (
    <div
      data-drop-zone={id}
      data-hover={hover === id ? "" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        onZoneOver?.(id);
      }}
      onDragLeave={() => onZoneOver?.(null)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onZoneOver?.(null);
        if (event.dataTransfer.files.length) onDropFiles?.(id, event.dataTransfer.files);
      }}
      className={`flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed p-6 text-lg font-bold ${hover === id ? "border-accent bg-accent/[0.08] text-accent" : "border-border bg-surface-1 text-fg"}`}
    >
      {label}
    </div>
  );
  return (
    <div data-drop-overlay className="absolute inset-0 z-30 flex flex-col gap-3 bg-surface/90 p-4">
      {zone("media", ct("chatui.composer.drop_images"))}
      {zone("files", ct("chatui.composer.drop_files"))}
    </div>
  );
}

/**
 * C2.5 — dropping files on the PANE. The composer host owns it; the two zones are drawn INTO the pane root (`data-chat-pane-root`, `relative`) as its direct
 * child, so they cover the pane without any file of the pane knowing it. The listeners are put on that root, and a drag that carries files draws the two zones
 * («ابعت كصور» / «ابعت كملفات»). A drag of text or a link draws nothing. `enabled` false (an edit, a recording, a send in progress): no zones, but the drag is still claimed, so a file dropped
 * then is ignored instead of being opened by the browser (which would leave the page and lose the draft).
 */
export function DropOverlay({ enabled, onDropFiles }: { enabled: boolean; onDropFiles: (zone: "media" | "files", files: FileList) => void }) {
  const marker = React.useRef<HTMLSpanElement | null>(null);
  const [active, setActive] = React.useState(false);
  const [hover, setHover] = React.useState<"media" | "files" | null>(null);
  const [root, setRoot] = React.useState<HTMLElement | null>(null);
  // the listeners stay while the composer is busy, editing or recording: a file dropped then is NOT the browser's (it would open it and leave the page);
  // only the two zones are not drawn
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  React.useEffect(() => {
    if (!enabled) setActive(false);
  }, [enabled]);
  React.useEffect(() => {
    const found = marker.current?.closest<HTMLElement>("[data-chat-pane-root]") ?? marker.current?.parentElement ?? null;
    setRoot(found);
  }, []);
  React.useEffect(() => {
    if (!root) return;
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer?.types)) return;
      event.preventDefault();
      if (!enabledRef.current) return;
      depth += 1;
      setActive(true);
    };
    const over = (event: DragEvent) => {
      if (dragHasFiles(event.dataTransfer?.types)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer?.types)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const drop = (event: DragEvent) => {
      // a drop outside the two zones is nothing: the zones stop their own
      if (dragHasFiles(event.dataTransfer?.types)) event.preventDefault();
      depth = 0;
      setActive(false);
      setHover(null);
    };
    root.addEventListener("dragenter", enter);
    root.addEventListener("dragover", over);
    root.addEventListener("dragleave", leave);
    root.addEventListener("drop", drop);
    return () => {
      root.removeEventListener("dragenter", enter);
      root.removeEventListener("dragover", over);
      root.removeEventListener("dragleave", leave);
      root.removeEventListener("drop", drop);
    };
  }, [root]);
  return (
    <>
      <span ref={marker} hidden />
      {active && root
        ? createPortal(
            <DropZones
              hover={hover}
              onZoneOver={setHover}
              onDropFiles={(zone, files) => {
                setActive(false);
                setHover(null);
                onDropFiles(zone, files);
              }}
            />,
            root,
          )
        : null}
    </>
  );
}
