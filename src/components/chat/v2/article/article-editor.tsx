"use client";

import React from "react";
import { Bold, Eye, Heading, ImagePlus, Italic, Link, List, ListOrdered, LoaderCircle, Pencil, Quote, X, type LucideIcon } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArticleBody, type ArticlePicture } from "@/components/chat/v2/article/article-body";
import { picturesOf } from "@/components/chat/v2/article/article-card";
import { articleBodyProblem, articleProblem, compactArticleImages, insertPictureLine, joinArticle, MAX_ARTICLE_BODY, MAX_ARTICLE_IMAGES, MAX_ARTICLE_TITLE, prefixLines, splitArticle } from "@/lib/chat/article";
import { onChatWipe } from "@/lib/chat/cache/registry";
import { compressImage, maxSideFor } from "@/lib/chat/compress-image";
import { createChatUploadFormData, messageClientId } from "@/lib/chat/conversation/client";
import { readDevicePrefs } from "@/lib/device-prefs";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { applyFormat, type FormatAction } from "@/lib/chat/v2/composer/format-keys";
import { ct } from "@/lib/chat/text";

/**
 * «المقالات» — writing one (or editing mine). A title, a plain box with the chat's own formatting and a few buttons (heading, bold, italic, lists, quote, link,
 * picture), and «معاينة» which draws it through the very component the reading page uses. A picture is uploaded when it is picked and put in as its own line
 * (`![1]`); only the pictures the words still name are sent. Editing changes the words only: the pictures of a sent article stay as they were.
 *
 * It is no `<form>` on purpose: it is opened from inside the composer, and nothing here may submit that. What was typed in a NEW article is kept in memory per
 * conversation, so closing the window loses nothing (it goes with a sign-out).
 */
export interface DraftPicture {
  id: string;
  src: string;
  name: string;
}
interface ArticleDraft {
  title: string;
  content: string;
  pictures: DraftPicture[];
}

const drafts = new Map<string, ArticleDraft>();
onChatWipe(() => drafts.clear());

const EMPTY: ArticleDraft = { title: "", content: "", pictures: [] };

type Tool = { id: string; icon: LucideIcon; label: string } & ({ prefix: string } | { format: FormatAction });
const TOOLS: Tool[] = [
  { id: "heading", icon: Heading, label: "tgx.article.tool.heading", prefix: "## " },
  { id: "bold", icon: Bold, label: "tgx.article.tool.bold", format: "bold" },
  { id: "italic", icon: Italic, label: "tgx.article.tool.italic", format: "italic" },
  { id: "bullets", icon: List, label: "tgx.article.tool.bullets", prefix: "- " },
  { id: "numbers", icon: ListOrdered, label: "tgx.article.tool.numbers", prefix: "1. " },
  { id: "quote", icon: Quote, label: "tgx.article.tool.quote", prefix: "> " },
  { id: "link", icon: Link, label: "tgx.article.tool.link", format: "link" },
];

export function ArticleEditor({ open, conversationId, editing, onClose, onSaved, portal = true }: { open: boolean; conversationId: string; /** my article being edited; null: a new one */ editing: MessageDto | null; onClose: () => void; onSaved: (message: MessageDto) => void; portal?: boolean }) {
  const [draft, setDraft] = React.useState<ArticleDraft>(() => (editing ? { ...splitArticle(editing.body ?? ""), pictures: [] } : (drafts.get(conversationId) ?? EMPTY)));
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [clientId, setClientId] = React.useState(() => messageClientId());
  const box = React.useRef<HTMLTextAreaElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const selection = React.useRef<{ start: number; end: number } | null>(null);
  const latest = React.useRef(draft);
  latest.current = draft;

  const change = (patch: Partial<ArticleDraft>) => {
    setClientId(messageClientId());
    setError("");
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    if (!editing) drafts.set(conversationId, next);
  };

  React.useEffect(() => {
    const el = box.current;
    const wanted = selection.current;
    if (!el || !wanted) return;
    selection.current = null;
    el.focus();
    el.setSelectionRange(wanted.start, wanted.end);
  }, [draft.content]);

  const apply = (tool: Tool) => {
    const el = box.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const edit = "prefix" in tool ? prefixLines(el.value, start, end, tool.prefix) : applyFormat(el.value, start, end, tool.format);
    selection.current = { start: edit.start, end: edit.end };
    change({ content: edit.value });
  };

  const addPicture = async (picked: File) => {
    if (uploading || latest.current.pictures.length >= MAX_ARTICLE_IMAGES) return;
    if (!picked.type.startsWith("image/")) return setError(ct("chat.e.article_images"));
    const at = box.current?.selectionStart ?? latest.current.content.length;
    setUploading(true);
    setError("");
    try {
      let upload = picked;
      const compressed = await compressImage(picked, picked.name, { maxSide: maxSideFor(readDevicePrefs().imageQuality) });
      if (compressed) upload = new File([compressed.blob], picked.name, { type: compressed.mime });
      const result = await uploadWithProgress("/api/chat/uploads", createChatUploadFormData(upload, "IMAGE"), () => undefined);
      if (typeof result["id"] !== "string") throw new Error("upload");
      const pictures = [...latest.current.pictures, { id: result["id"], src: URL.createObjectURL(upload), name: picked.name }];
      const placed = insertPictureLine(latest.current.content, Math.min(at, latest.current.content.length), pictures.length);
      selection.current = { start: placed.caret, end: placed.caret };
      change({ pictures, content: placed.value });
    } catch {
      setError(ct("chatc.upload_failed"));
    } finally {
      setUploading(false);
    }
  };

  const pictures: (ArticlePicture | null)[] = editing ? picturesOf(editing.attachments) : draft.pictures;
  const problem = articleProblem(draft.title, draft.content);

  const save = async () => {
    if (busy || uploading || problem) return;
    setBusy(true);
    setError("");
    try {
      let response: Response;
      if (editing) {
        const body = joinArticle(draft.title, draft.content);
        if (articleBodyProblem(body)) throw new Error(ct("chatc.message_failed"));
        response = await fetch(`/api/chat/messages/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      } else {
        const packed = compactArticleImages(draft.content, draft.pictures.length);
        response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: joinArticle(draft.title, packed.content), article: true, attachmentIds: packed.used.map((i) => draft.pictures[i]!.id), mentions: [], clientId }),
        });
      }
      if (!response.ok) {
        const key = errorKeyOf(await response.json().catch(() => null));
        throw new Error(ct(key ?? "chatc.message_failed"));
      }
      const message = (await response.json()) as MessageDto;
      if (!editing) {
        drafts.delete(conversationId);
        for (const p of draft.pictures) URL.revokeObjectURL(p.src);
      }
      onSaved(message);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ct("chatc.message_failed"));
      setBusy(false);
    }
  };

  const tool = "flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40";
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent portal={portal} size="xl" aria-describedby={undefined} data-article-editor="" className="h-[calc(100dvh-2rem)] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:max-w-full max-md:rounded-none max-md:border-0">
        <DialogHeader>
          <DialogTitle>{ct(editing ? "tgx.article.edit_title" : "tgx.article.new_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <label htmlFor="article-title" className="sr-only">
            {ct("tgx.article.title_label")}
          </label>
          <input id="article-title" dir="auto" maxLength={MAX_ARTICLE_TITLE} value={draft.title} onChange={(e) => change({ title: e.currentTarget.value })} placeholder={ct("tgx.article.title_placeholder")} className="min-h-11 w-full rounded-lg border border-muted bg-surface px-3 text-lg font-bold" />
          <div role="toolbar" aria-label={ct("tgx.article.tools")} className="flex flex-wrap items-center gap-1">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" data-article-tool={t.id} disabled={preview} aria-label={ct(t.label)} title={ct(t.label)} onClick={() => apply(t)} className={tool}>
                  <Icon aria-hidden="true" className="size-5" />
                </button>
              );
            })}
            {editing ? null : (
              <button type="button" data-article-tool="picture" disabled={preview || uploading || draft.pictures.length >= MAX_ARTICLE_IMAGES} aria-label={ct("tgx.article.tool.picture")} title={ct("tgx.article.tool.picture")} onClick={() => file.current?.click()} className={tool}>
                {uploading ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> : <ImagePlus aria-hidden="true" className="size-5" />}
              </button>
            )}
            <button type="button" data-article-preview="" aria-pressed={preview} onClick={() => setPreview((v) => !v)} className="ms-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface-2">
              {preview ? <Pencil aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
              {ct(preview ? "tgx.article.write" : "tgx.article.preview")}
            </button>
          </div>
          {preview ? (
            <div className="min-h-48 flex-1 rounded-lg border border-border p-3">
              <p dir="auto" className="pb-2 text-xl font-bold leading-8">
                {draft.title}
              </p>
              <ArticleBody content={draft.content} pictures={pictures} />
            </div>
          ) : (
            <>
              <label htmlFor="article-content" className="sr-only">
                {ct("tgx.article.content_label")}
              </label>
              <textarea id="article-content" ref={box} dir="auto" maxLength={MAX_ARTICLE_BODY} value={draft.content} onChange={(e) => change({ content: e.currentTarget.value })} placeholder={ct("tgx.article.content_placeholder")} className="min-h-48 w-full flex-1 resize-none rounded-lg border border-muted bg-surface px-3 py-2 text-base leading-8" />
              <p className="text-xs text-fg-muted">{ct(editing ? "tgx.article.edit_hint" : "tgx.article.hint")}</p>
            </>
          )}
          {!editing && draft.pictures.length > 0 ? (
            <ul data-article-pictures="" className="flex gap-2 overflow-x-auto">
              {draft.pictures.map((p, i) => (
                <li key={p.id} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview of my own pick */}
                  <img src={p.src} alt={p.name} className="size-16 rounded-lg object-cover" />
                  <span className="absolute start-1 top-1 rounded-full bg-surface-1 px-1.5 text-xs font-bold">{i + 1}</span>
                </li>
              ))}
              <li className="flex items-center">
                <button
                  type="button"
                  data-article-clear-pictures=""
                  aria-label={ct("tgx.article.drop_pictures")}
                  title={ct("tgx.article.drop_pictures")}
                  onClick={() => change({ pictures: [], content: compactArticleImages(latest.current.content, 0).content })}
                  className={tool}
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </li>
            </ul>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {ct("chatc.cancel")}
          </Button>
          <Button type="button" data-article-send="" disabled={busy || uploading || problem !== null} onClick={() => void save()}>
            {busy ? ct("chatc.sending") : ct(editing ? "chatc.save" : "tgx.article.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
