"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { ConversationPickerDialog } from "@/components/chat/v2/feedback/conversation-picker";
import { sendInOrder, sendableFeedbackIds } from "@/lib/chat/v2/feedback/feedback-model";
import { layoutCollage, MAX_PICTURES, MIN_PICTURES } from "@/lib/cards/collage-layout";
import { copyImage, coverPicture, downloadBlob, loadImage, pngBlobOf, renderCollagePage, safeFileName, shareFiles, type CoverRect } from "@/lib/cards/media-client";
import type { MediaListDTO, MediaItemDTO } from "@/server/services/knowledge-media";

const btn = "inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs hover:bg-surface-2 disabled:opacity-60";

async function postForm(url: string, form: FormData): Promise<Response> {
  return fetch(url, { method: "POST", body: form });
}

/**
 * The pictures of a product sheet (Q1.2): the photos on top, swipeable; on any picture «انسخي الصورة», «نزّليها», «شاركيها»; the feedback gallery («آراء
 * الزباين») with several selected → one by one, or merged into ONE picture built here in the browser; and for the editors the adding of a photo and of a
 * feedback picture, whose private parts are covered here, in the browser, before anything is sent.
 */
export function SheetMedia({ cardId, productName }: { cardId: string; productName: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sheet-media", cardId], queryFn: () => apiGet<MediaListDTO>(`/api/knowledge/${encodeURIComponent(cardId)}/media`), retry: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState<{ blobs: Blob[]; urls: string[] } | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  // «ابعتيها بالمحادثة» (Q1.2): the pictures waiting for the person to choose the conversation (stored ones only: the sheet's own door copies them into the chat)
  const [sending, setSending] = useState<string[] | null>(null);
  const [sendBusy, setSendBusy] = useState(false);

  if (q.isPending || q.isError || !q.data) return null;
  const data = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["sheet-media", cardId] });

  async function blobOf(item: MediaItemDTO): Promise<Blob> {
    return pngBlobOf(item.url);
  }

  async function onCopy(item: MediaItemDTO) {
    try {
      const r = await copyImage(await blobOf(item), safeFileName(productName, "png"));
      toast(t(r === "copied" ? "media.copied" : "media.copy_downloaded"), "success");
    } catch {
      toast(t("common.error"), "error");
    }
  }
  async function onDownload(item: MediaItemDTO, i: number) {
    try {
      downloadBlob(await blobOf(item), safeFileName(`${productName} ${i + 1}`, "png"));
    } catch {
      toast(t("common.error"), "error");
    }
  }
  async function onShare(items: MediaItemDTO[], names: string[]) {
    try {
      const files = await Promise.all(items.map(async (it, i) => new File([await blobOf(it)], names[i]!, { type: "image/png" })));
      if (!(await shareFiles(files, productName))) {
        files.forEach((f) => downloadBlob(f, f.name));
        toast(t("media.share_downloaded"), "success");
      }
    } catch {
      toast(t("common.error"), "error");
    }
  }

  const chosen = data.feedback.filter((f) => selected.includes(f.id));
  // what may go into a chat: only the approved ones with the customer's consent, at most ten (an editor's list also holds the others)
  const sendable = sendableFeedbackIds(chosen);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function makeCollage() {
    if (chosen.length < MIN_PICTURES || chosen.length > MAX_PICTURES) return;
    setBusy(true);
    try {
      const images = await Promise.all(chosen.map((c) => loadImage(c.url)));
      const out = layoutCollage(images.map((i) => ({ width: i.naturalWidth, height: i.naturalHeight })), { caption: productName });
      const blobs = await Promise.all(out.pages.map((p) => renderCollagePage(p, images)));
      setMerged((old) => {
        old?.urls.forEach((u) => URL.revokeObjectURL(u));
        return { blobs, urls: blobs.map((b) => URL.createObjectURL(b)) };
      });
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadGallery(file: File) {
    const form = new FormData();
    form.set("role", "GALLERY");
    form.set("file", file);
    const r = await postForm(`/api/knowledge/${encodeURIComponent(cardId)}/media`, form);
    toast(t(r.ok ? "media.added" : "common.error"), r.ok ? "success" : "error");
    if (r.ok) void refresh();
  }

  async function remove(item: MediaItemDTO) {
    if (!window.confirm(t("media.remove_confirm"))) return;
    try {
      await apiDelete(`/api/knowledge/${encodeURIComponent(cardId)}/media/${encodeURIComponent(item.id)}`);
      void refresh();
    } catch {
      toast(t("common.error"), "error");
    }
  }

  async function setState(item: MediaItemDTO, body: { consent?: boolean; approve?: boolean }) {
    const r = await fetch(`/api/knowledge/${encodeURIComponent(cardId)}/media/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) toast(t("common.error"), "error");
    void refresh();
  }

  async function sendToChat(conversationId: string) {
    if (!sending || sendBusy) return;
    setSendBusy(true);
    const { sent, failed } = await sendInOrder(sending, async (attId) => {
      const r = await fetch(`/api/knowledge/${encodeURIComponent(cardId)}/media/${encodeURIComponent(attId)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId }) });
      if (!r.ok) throw new Error(String(r.status));
      return attId;
    });
    setSendBusy(false);
    if (failed) {
      toast(t("chatui.pick.failed"), "error");
      // what went is not sent twice: the picker stays open on what is left
      if (sent.length > 0) setSending(sending.slice(sent.length));
      return;
    }
    toast(t("chatui.pick.sent"), "success");
    setSending(null);
  }

  const hasAny = data.gallery.length > 0 || data.feedback.length > 0 || data.canEdit;
  if (!hasAny) return null;

  return (
    <section aria-label={t("media.title")} className="space-y-3 rounded-[14px] bg-surface-1 p-3" data-sheet-media>
      <h2 className="text-sm font-semibold">{t("media.photos")}</h2>
      {data.gallery.length > 0 ? (
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1" data-gallery>
          {data.gallery.map((p, i) => (
            <li key={p.id} className="w-64 shrink-0 snap-start space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption ?? productName} className="h-64 w-64 rounded-lg border border-border object-cover" loading="lazy" />
              <div className="flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => void onCopy(p)}>{t("media.copy")}</button>
                <button type="button" className={btn} onClick={() => void onDownload(p, i)}>{t("media.download")}</button>
                <button type="button" className={btn} onClick={() => void onShare([p], [safeFileName(`${productName} ${i + 1}`, "png")])}>{t("media.share")}</button>
                <button type="button" className={btn} data-send-chat={p.id} onClick={() => setSending([p.id])}>{t("chatui.pick.send_chat")}</button>
                {data.canEdit ? <button type="button" className={btn} onClick={() => void remove(p)}>{t("media.remove")}</button> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">{t("media.none")}</p>
      )}
      {data.canEdit ? <AddPhoto onFile={uploadGallery} label={t("media.add_photo")} /> : null}

      <h2 className="pt-2 text-sm font-semibold">{t("media.feedback")}</h2>
      {data.feedback.length > 0 ? (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-feedback>
            {data.feedback.map((f) => (
              <li key={f.id} className="space-y-1">
                <button type="button" aria-pressed={selected.includes(f.id)} onClick={() => toggle(f.id)} className={`relative block w-full overflow-hidden rounded-lg border ${selected.includes(f.id) ? "border-accent ring-2 ring-accent" : "border-border"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={t("media.feedback_item")} className="h-28 w-full object-cover" loading="lazy" />
                </button>
                {f.state ? (
                  <div className="space-y-1 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={f.state.consent} onChange={(e) => void setState(f, { consent: e.target.checked })} />
                      {t("media.consent")}
                    </label>
                    {data.canApprove && f.state.consent ? (
                      <button type="button" className={btn} onClick={() => void setState(f, { approve: !f.state!.approved })}>{t(f.state.approved ? "media.unapprove" : "media.approve")}</button>
                    ) : null}
                    {!f.state.approved ? <span className="text-warn">{t("media.not_offered")}</span> : null}
                    <button type="button" className={btn} onClick={() => void remove(f)}>{t("media.remove")}</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {chosen.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" data-feedback-actions>
              <span className="text-xs text-muted">{t("media.selected").replace("{n}", String(chosen.length))}</span>
              <button type="button" className={btn} onClick={() => void onShare(chosen, chosen.map((_, i) => safeFileName(`${productName} ${i + 1}`, "png")))}>{t("media.one_by_one")}</button>
              {sendable.length > 0 ? (
                <button type="button" className={btn} data-send-chat-chosen onClick={() => setSending(sendable)}>{t("chatui.pick.send_chosen")}</button>
              ) : null}
              <button type="button" className={btn} disabled={busy || chosen.length < MIN_PICTURES || chosen.length > MAX_PICTURES} onClick={() => void makeCollage()}>{t("media.merge")}</button>
              {chosen.length < MIN_PICTURES ? <span className="text-xs text-muted">{t("media.merge_min")}</span> : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted">{t("media.feedback_none")}</p>
      )}
      {data.canEdit && !cover ? <AddPhoto onFile={(f) => setCover(f)} label={t("media.add_feedback")} /> : null}

      {merged ? (
        <div className="space-y-2 rounded-lg border border-border p-2" data-collage-preview>
          <p className="text-xs font-semibold">{t("media.preview")}</p>
          {merged.urls.map((u, i) => (
            <div key={u} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={t("media.preview")} className="max-h-72 rounded border border-border" />
              <div className="flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => downloadBlob(merged.blobs[i]!, safeFileName(`آراء-${productName}${merged.blobs.length > 1 ? ` ${i + 1}` : ""}`, "jpg"))}>{t("media.download")}</button>
                <button type="button" className={btn} onClick={() => void copyImage(merged.blobs[i]!, safeFileName(`آراء-${productName}`, "jpg")).then((r) => toast(t(r === "copied" ? "media.copied" : "media.copy_downloaded"), "success"))}>{t("media.copy")}</button>
                <button type="button" className={btn} onClick={() => void shareFiles([new File([merged.blobs[i]!], safeFileName(`آراء-${productName}`, "jpg"), { type: "image/jpeg" })], productName).then((ok) => { if (!ok) downloadBlob(merged.blobs[i]!, safeFileName(`آراء-${productName}`, "jpg")); })}>{t("media.share")}</button>
              </div>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => { merged.urls.forEach((u) => URL.revokeObjectURL(u)); setMerged(null); }}>{t("media.close")}</button>
        </div>
      ) : null}

      {/* drawn only while a choice is wanted: the chat list is asked for when the picker opens, never for every sheet that is read */}
      {sending !== null ? <ConversationPickerDialog open onClose={() => setSending(null)} onPick={(id) => void sendToChat(id)} busy={sendBusy} /> : null}

      {cover ? <CoverTool key={`${cover.name}:${cover.size}:${cover.lastModified}`} file={cover} onCancel={() => setCover(null)} onDone={async (blob, consent) => {
        const form = new FormData();
        form.set("role", "FEEDBACK");
        form.set("covered", "1");
        if (consent) form.set("consent", "1");
        form.set("file", new File([blob], "feedback.jpg", { type: "image/jpeg" }));
        const r = await postForm(`/api/knowledge/${encodeURIComponent(cardId)}/media`, form);
        toast(t(r.ok ? "media.added" : "common.error"), r.ok ? "success" : "error");
        if (r.ok) { setCover(null); void refresh(); }
      }} /> : null}
    </section>
  );
}

function AddPhoto({ onFile, label }: { onFile: (f: File) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <button type="button" className={btn} onClick={() => ref.current?.click()}>{label}</button>
    </>
  );
}

/**
 * The cover tool: the chosen picture, and rectangles dragged over the name, the number and the profile picture. «ارفعي» paints them into the pixels in the
 * browser and sends ONLY the covered picture; the original never leaves the phone. The customer's consent is ticked here; an approver approves afterwards.
 */
function CoverTool({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (covered: Blob, consent: boolean) => Promise<void> }) {
  const { t } = useI18n();
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [rects, setRects] = useState<CoverRect[]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState<CoverRect | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): CoverRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  return (
    <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-2" data-cover-tool>
      <p className="text-xs">{t("media.cover_help")}</p>
      <div ref={box} className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded border border-border"
        onPointerDown={(e) => { box.current?.setPointerCapture(e.pointerId); setDrag(point(e)); setNow(null); }}
        onPointerMove={(e) => { if (drag) setNow(rectOf(drag, point(e))); }}
        onPointerCancel={() => { setDrag(null); setNow(null); }}
        onPointerUp={() => { if (now && now.w > 0.01 && now.h > 0.01) setRects((r) => [...r, now]); setDrag(null); setNow(null); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" draggable={false} className="block max-h-96 max-w-full" />
        {[...rects, ...(now ? [now] : [])].map((r, i) => (
          <span key={i} className="absolute" style={{ backgroundColor: "black" /* the colour the exported picture gets, so the preview is the truth */, left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={rects.length === 0} onClick={() => setRects((r) => r.slice(0, -1))}>{t("media.cover_undo")}</button>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{t("media.consent")}</label>
      </div>
      <p className="text-xs text-fg-muted">{t("media.cover_note")}</p>
      <div className="flex gap-2">
        <button type="button" className={`${btn} bg-accent text-accent-fg`} disabled={busy || rects.length === 0} onClick={async () => { setBusy(true); try { await onDone(await coverPicture(file, rects), consent); } finally { setBusy(false); } }}>{busy ? "…" : t("media.upload_covered")}</button>
        <button type="button" className={btn} onClick={() => { URL.revokeObjectURL(url); onCancel(); }}>{t("media.cancel")}</button>
      </div>
    </div>
  );
}
