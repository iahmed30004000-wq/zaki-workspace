"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";

/**
 * «الصبورة» of one conversation: Excalidraw (MIT) in the browser, its drawing kept by the server
 * (src/server/chat/whiteboard.ts). What this screen changes goes up a moment after the hand stops (only the elements
 * that changed); what somebody else draws arrives as `whiteboard.changed`, is fetched and merged with Excalidraw's own
 * `reconcileElements`, so nobody's stroke wipes another's. Whoever may not write in the conversation only looks.
 *
 * Excalidraw's fonts are served from this app (`/excalidraw/`, copied there at build by
 * scripts/copy-whiteboard-assets.mjs), not from a public CDN.
 */

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => <p className="p-4 text-fg-muted">{ct("whiteboard.loading")}</p>,
});

/** A pause in drawing this long sends what changed. */
const SAVE_AFTER_MS = 700;

interface Board {
  elements: OrderedExcalidrawElement[];
  version: number;
  canDraw: boolean;
}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export function WhiteboardScreen({ conversationId, title }: { conversationId: string; title: string }) {
  const [board, setBoard] = React.useState<Board | null>(null);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "failed">("idle");
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null);
  // the version of each element the server already has: only newer ones go up
  const known = React.useRef(new Map<string, number>());
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `/api/chat/conversations/${encodeURIComponent(conversationId)}/whiteboard`;
  const dark = useDarkTheme();

  if (typeof window !== "undefined" && !window.EXCALIDRAW_ASSET_PATH) window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";

  const remember = (elements: readonly OrderedExcalidrawElement[]) => {
    for (const e of elements) known.current.set(e.id, Math.max(e.version, known.current.get(e.id) ?? 0));
  };

  React.useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(ct(r.status === 404 ? "whiteboard.not_found" : "whiteboard.load_failed"));
        return (await r.json()) as Board;
      })
      .then((b) => {
        if (!alive) return;
        remember(b.elements);
        setBoard(b);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : ct("whiteboard.load_failed")));
    return () => {
      alive = false;
    };
  }, [url]);

  /** Somebody else drew: fetch the board and merge it into what is on this screen. */
  const pull = React.useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return;
      const remote = (await r.json()) as Board;
      const { reconcileElements, CaptureUpdateAction } = await import("@excalidraw/excalidraw");
      const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), remote.elements as unknown as Parameters<typeof reconcileElements>[1], api.getAppState());
      remember(remote.elements);
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    } catch {
      // the next event or the next visit brings it
    }
  }, [url]);

  useRealtime((event) => {
    if (event.kind === "whiteboard.changed" && event.conversationId === conversationId) void pull();
    // the polling fallback and a reconnect: look again
    if (!event.conversationId && event.kind === "conversation.changed") void pull();
  });

  /** Sends the elements this screen changed since the last save. */
  const push = React.useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const changed = api.getSceneElementsIncludingDeleted().filter((e) => (known.current.get(e.id) ?? -1) < e.version);
    if (changed.length === 0) return;
    setStatus("saving");
    try {
      const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ elements: changed }) });
      if (!r.ok) throw new Error("save");
      remember(changed);
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }, [url]);

  const onChange = React.useCallback(() => {
    if (!board?.canDraw) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void push(), SAVE_AFTER_MS);
  }, [board?.canDraw, push]);

  // «المرشد» (the owner's guide, src/components/site-guide): while this board is open it may read the words on it and add notes and boxes.
  // Only a person who may draw gets `canDraw`; what it adds goes through the same autosave as a hand-drawn stroke, and Excalidraw's undo takes it back.
  const canDraw = board?.canDraw === true;
  React.useEffect(() => {
    if (!board) return;
    window.__zakiBoard = {
      canDraw,
      texts: () => {
        const out: string[] = [];
        for (const e of apiRef.current?.getSceneElements() ?? []) {
          const text = (e as { text?: unknown }).text;
          if (typeof text === "string" && text.trim()) out.push(text.trim());
        }
        return out;
      },
      write: async (items) => {
        const api = apiRef.current;
        if (!api || !canDraw || items.length === 0) return 0;
        const { convertToExcalidrawElements, CaptureUpdateAction } = await import("@excalidraw/excalidraw");
        const existing = api.getSceneElements();
        // new things go below what is already there unless the guide gave a place
        const bottom = existing.reduce((m, e) => Math.max(m, e.y + e.height), 0);
        let nextY = existing.length > 0 ? bottom + 60 : 0;
        const skeleton = items.map((item) => {
          const x = item.x ?? 0;
          const y = item.y ?? nextY;
          if (item.y === undefined) nextY += item.kind === "box" ? 140 : 70;
          return item.kind === "box"
            ? { type: "rectangle" as const, x, y, width: 260, height: 100, label: { text: item.text, fontSize: 20 } }
            : { type: "text" as const, x, y, text: item.text, fontSize: 24 };
        });
        const made = convertToExcalidrawElements(skeleton);
        api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...made], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        api.scrollToContent(made, { fitToViewport: false, animate: true });
        return made.length;
      },
    };
    return () => {
      delete window.__zakiBoard;
    };
  }, [board, canDraw]);

  // leaving the page sends what is left
  React.useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void push();
    }
  }, [push]);

  const statusText = status === "saving" ? ct("whiteboard.saving") : status === "saved" ? ct("whiteboard.saved") : status === "failed" ? ct("whiteboard.save_failed") : "";

  return (
    <section dir="rtl" lang="ar" className="flex h-full min-h-0 flex-col" aria-label={ct("whiteboard.title")}>
      <header className="flex items-center gap-3 border-b border-border p-3">
        <Link href={`/chat/${encodeURIComponent(conversationId)}`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-surface-2">
          {ct("whiteboard.back")}
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{ct("whiteboard.title_of", { title })}</h1>
          <p className="text-sm text-fg-muted">{board && !board.canDraw ? ct("whiteboard.view_only") : statusText}</p>
        </div>
      </header>
      {error ? (
        <p role="alert" className="p-4 text-danger">{error}</p>
      ) : board ? (
        // Excalidraw draws its own left-to-right toolbar; its words are Arabic (langCode)
        <div dir="ltr" className="relative min-h-[60vh] flex-1">
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            initialData={{ elements: board.elements, scrollToContent: true }}
            onChange={onChange}
            viewModeEnabled={!board.canDraw}
            langCode="ar-SA"
            theme={dark ? "dark" : "light"}
            UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: null } }}
          />
        </div>
      ) : (
        <p className="p-4 text-fg-muted">{ct("whiteboard.loading")}</p>
      )}
    </section>
  );
}

/** The app's theme is dark when <html> carries the `dark` class (the night themes). */
function useDarkTheme(): boolean {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const html = document.documentElement;
    const read = () => setDark(html.classList.contains("dark"));
    read();
    const watch = new MutationObserver(read);
    watch.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => watch.disconnect();
  }, []);
  return dark;
}
