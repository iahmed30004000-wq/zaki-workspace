"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, CirclePlus, LoaderCircle, X } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { GifThumb } from "@/components/chat/v2/bubble/gif-image";
import { messageClientId } from "@/lib/chat/conversation/client";
import { dropGif, fetchGifs, GifError, GIFS_KEY, keepGif, sendGif, uploadGif, type GifDto, type GifListDto } from "@/lib/chat/gifs";
import { playChatSound } from "@/lib/chat/sounds";
import { ct } from "@/lib/chat/text";

/**
 * «صور متحركة» — the tab of the composer's picker: MY OWN library (kept ones, then the ones I sent lately) and «ارفع صورة متحركة». ONE TAP on a picture sends it. Nothing here
 * asks anybody outside the app: the list, the pictures and the send are the app's own doors, and the server judges every one of them.
 */

export interface GifGridProps {
  list: GifListDto | null;
  failed: boolean;
  /** the address of the one being sent, or "upload" while a file goes up */
  busy: string | null;
  error: string;
  /** the library row whose «شيلها» is asking to be confirmed */
  removing: string | null;
  onSend: (gif: GifDto) => void;
  onKeep: (gif: GifDto) => void;
  onAskRemove: (savedId: string | null) => void;
  onRemove: (savedId: string) => void;
  onUpload: (file: File) => void;
  onRetry: () => void;
}

const CORNER = "absolute end-1 top-1 grid size-8 place-items-center rounded-full bg-surface-1/90 text-fg shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60";

export function GifGrid({ list, failed, busy, error, removing, onSend, onKeep, onAskRemove, onRemove, onUpload, onRetry }: GifGridProps) {
  const input = React.useRef<HTMLInputElement>(null);
  const tile = (gif: GifDto) => {
    const key = gif.savedId ?? gif.attachmentId ?? gif.url;
    return (
      <li key={key} data-gif-tile={gif.savedId ? "saved" : "recent"} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
        <button type="button" data-gif-send={key} aria-label={ct("gifs.send", { name: gif.name })} disabled={busy !== null} onClick={() => onSend(gif)} className="block size-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
          <GifThumb src={gif.url} alt="" />
        </button>
        {busy === gif.url ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center bg-scrim/60 text-on-photo">
            <LoaderCircle className="size-6 motion-safe:animate-spin" />
          </span>
        ) : null}
        {gif.savedId ? (
          removing === gif.savedId ? (
            <button type="button" data-gif-remove-confirm={gif.savedId} onClick={() => onRemove(gif.savedId!)} onBlur={() => onAskRemove(null)} className="absolute inset-x-1 top-1 min-h-8 rounded-full bg-danger px-2 text-xs font-semibold text-danger-fg shadow-card">
              {ct("gifs.remove_confirm")}
            </button>
          ) : (
            <button type="button" data-gif-remove={gif.savedId} aria-label={ct("gifs.remove", { name: gif.name })} disabled={busy !== null} onClick={() => onAskRemove(gif.savedId!)} className={CORNER}>
              <X aria-hidden="true" className="size-4" />
            </button>
          )
        ) : gif.kept ? null : (
          <button type="button" data-gif-keep={gif.attachmentId} aria-label={ct("gifs.keep", { name: gif.name })} disabled={busy !== null} onClick={() => onKeep(gif)} className={CORNER}>
            <BookmarkPlus aria-hidden="true" className="size-4" />
          </button>
        )}
      </li>
    );
  };
  const section = (title: string, gifs: GifDto[], name: "saved" | "recent") =>
    gifs.length === 0 ? null : (
      <section data-gif-section={name}>
        <h3 className="px-1 pb-1 pt-2 text-xs font-semibold text-fg-muted">{title}</h3>
        <ul className="grid grid-cols-3 gap-1">{gifs.map(tile)}</ul>
      </section>
    );
  return (
    <div data-gif-panel="" role="group" aria-label={ct("gifs.panel")} className="flex h-full min-h-0 flex-col gap-1 px-2 pt-1">
      <button type="button" data-gif-upload="" disabled={busy !== null} onClick={() => input.current?.click()} className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold text-accent disabled:opacity-60">
        {busy === "upload" ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> : <CirclePlus aria-hidden="true" className="size-5" />}
        {ct(busy === "upload" ? "gifs.uploading" : "gifs.upload")}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onUpload(file);
        }}
      />
      {error ? (
        <p role="alert" className="shrink-0 px-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {list ? (
          list.saved.length === 0 && list.recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">{ct("gifs.empty")}</p>
          ) : (
            <>
              {section(ct("gifs.saved"), list.saved, "saved")}
              {section(ct("gifs.recent"), list.recent, "recent")}
            </>
          )
        ) : failed ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-fg-muted">
            <p>{ct("gifs.load_failed")}</p>
            <button type="button" data-gif-retry="" onClick={onRetry} className="min-h-11 rounded-full px-4 font-semibold text-accent">
              {ct("gifs.retry")}
            </button>
          </div>
        ) : (
          <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
            {ct("gifs.loading")}
          </p>
        )}
      </div>
    </div>
  );
}

const sentence = (e: unknown, fallback: string): string => ct(e instanceof GifError ? e.key : fallback);

/** The tab with its data. It is mounted only while the tab is shown, so nothing is asked for a person who never opens it. */
export function GifPanel({ conversationId, replyToId, replyQuote, onSent }: { conversationId: string; replyToId?: string; replyQuote?: string; onSent: (message: MessageDto) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: GIFS_KEY, queryFn: ({ signal }) => fetchGifs(signal), staleTime: 0, retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [removing, setRemoving] = React.useState<string | null>(null);
  // a second tap that lands before the first answer sends nothing
  const sending = React.useRef(false);
  // a retry of the same picture after a lost answer reuses its id, so it can never be sent twice
  const retry = React.useRef<{ url: string; clientId: string } | null>(null);
  const reload = () => void qc.invalidateQueries({ queryKey: GIFS_KEY });

  async function act(key: string, fallback: string, run: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(key);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(sentence(e, fallback));
      reload();
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <GifGrid
      list={list.data ?? null}
      failed={list.isError}
      busy={busy}
      error={error}
      removing={removing}
      onRetry={() => void list.refetch()}
      onAskRemove={setRemoving}
      onSend={(gif) =>
        void act(gif.url, "gifs.send_failed", async () => {
          const clientId = retry.current?.url === gif.url ? retry.current.clientId : messageClientId();
          retry.current = { url: gif.url, clientId };
          const message = await sendGif({ conversationId, gif, clientId, ...(replyToId ? { replyToId } : {}), ...(replyQuote ? { replyQuote } : {}) });
          retry.current = null;
          playChatSound("sent");
          reload();
          onSent(message);
        })
      }
      onKeep={(gif) =>
        void act("keep", "gifs.save_failed", async () => {
          await keepGif(gif.attachmentId ?? "");
          reload();
        })
      }
      onRemove={(savedId) =>
        void act("remove", "gifs.remove_failed", async () => {
          setRemoving(null);
          await dropGif(savedId);
          reload();
        })
      }
      onUpload={(file) =>
        void act("upload", "gifs.upload_failed", async () => {
          await uploadGif(file);
          reload();
        })
      }
    />
  );
}
