"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type { MessageDto } from "@/server/chat/dto";
import { CustomerHint } from "@/components/chat/v2/bubble/bubble-extras";
import { AttachMenu } from "@/components/chat/v2/composer/attach-menu";
import { EmojiPopover } from "@/components/chat/v2/composer/emoji-panel";
import { FileTray } from "@/components/chat/v2/composer/file-tray";
import { FormatToolbar } from "@/components/chat/v2/composer/format-toolbar";
import { MentionList } from "@/components/chat/v2/composer/mention-list";
import { RecordBar } from "@/components/chat/v2/composer/record-bar";
import { ReplyEditBar } from "@/components/chat/v2/composer/reply-edit-bar";
import { ct } from "@/lib/chat/text";
import { firstLink, hostOf } from "@/lib/chat/format/links";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { applyFormat, formatActionOf, type FormatAction } from "@/lib/chat/v2/composer/format-keys";
import type { ComposerEngine } from "@/lib/chat/v2/composer/use-composer";

/** What the surface reads of the engine (a test builds one by hand). */
export type SurfaceEngine = Pick<
  ComposerEngine,
  | "body" | "files" | "busy" | "error" | "progress" | "voice" | "face" | "canSubmit" | "choices" | "pickAt" | "setPick" | "hint"
  | "textRef" | "mediaInput" | "fileInput" | "addFiles" | "removeFile" | "selectMention"
  | "onTextChange" | "onKeyDown" | "onPaste" | "submit" | "cancelRecording" | "sendVoice" | "onMicPointerDown" | "onMicClick"
  | "setPollOpen" | "setRecall"
>;

export interface SurfaceProps {
  c: SurfaceEngine;
  me: { canPoll?: boolean; canRecall?: boolean };
  reply: MessageDto | null;
  editing: MessageDto | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  recents: string[];
  onEmoji: (emoji: string) => void;
  /** the company's switch `chatFormatting` (C3b.1; absent: on): off, no toolbar over the selection and no formatting shortcut */
  formatting?: boolean;
  /** the company's switch `linkPreviews` (C3b.2; absent: on): off, the line about the link's preview is not drawn */
  linkPreviews?: boolean;
  /**
   * C3b.2: the person pressed ✕ on the preview of the link in the box (`true`), or the link changed or went (`false`): the send must carry `noPreview` while it is
   * `true`, and the server then never visits the link. The surface only reports it; the composer that sends (`useComposer`) reads it.
   */
  onNoPreviewChange?: (noPreview: boolean) => void;
}

/**
 * C2.5 — the composer as it is drawn: `[😊] [ textarea ] [📎] [⚡] [🎤 ⇄ ➤]` under the reply / edit bar, the tray, the customer-data line and the «@» list.
 * The round button is the microphone while the box is empty, send when there is text or a file, save while an edit is typed (`composerFaceOf`). While a voice
 * note is recorded the whole row is the record bar. Everything it shows comes from the engine; it holds only whether the emoji picker is open.
 */
export function ComposerSurface({ c, me, reply, editing, onCancelReply, onCancelEdit, recents, onEmoji, formatting = true, linkPreviews = true, onNoPreviewChange }: SurfaceProps) {
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  // C3b.2: the first https link of the draft is what the server will visit after the send; ✕ says «no preview» for THAT link (another first link brings the line back)
  const draftLink = linkPreviews && !editing ? firstLink(c.body) : null;
  const previewHref = draftLink && draftLink.href.startsWith("https://") ? draftLink.href : null;
  const [previewOff, setPreviewOff] = React.useState<string | null>(null);
  const noPreview = previewHref !== null && previewOff === previewHref;
  React.useEffect(() => {
    onNoPreviewChange?.(noPreview);
  }, [noPreview, onNoPreviewChange]);
  // the link went (the message was sent, or the words were cleared): a ✕ does not follow the person to the next message
  React.useEffect(() => {
    if (previewHref === null) setPreviewOff(null);
  }, [previewHref]);
  const closeEmoji = React.useCallback(() => setEmojiOpen(false), []);
  // C3b.1: words selected in the box show the formatting bar; an action (a press on it, or Ctrl+B ...) rewrites the text and puts the selection back on the same words
  const [selected, setSelected] = React.useState(false);
  const pendingSelection = React.useRef<{ start: number; end: number } | null>(null);
  // the box grows with its words up to ten lines (its max-height), then scrolls
  const { body, textRef } = c;
  React.useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, textRef]);
  React.useEffect(() => {
    const el = textRef.current;
    const wanted = pendingSelection.current;
    if (!el || !wanted) return;
    pendingSelection.current = null;
    el.setSelectionRange(wanted.start, wanted.end);
    setSelected(wanted.end > wanted.start);
  }, [body, textRef]);
  const applyAction = (action: FormatAction) => {
    const el = textRef.current;
    if (!el) return;
    const edit = applyFormat(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, action);
    pendingSelection.current = { start: edit.start, end: edit.end };
    c.onTextChange(edit.value);
    el.focus();
  };
  const onBoxKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const action = formatting
      ? formatActionOf({ key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, isComposing: event.nativeEvent.isComposing })
      : null;
    if (action) {
      // Ctrl+K here is the link; the app's palette (a window listener) never sees it while the box has the focus
      event.preventDefault();
      event.stopPropagation();
      applyAction(action);
      return;
    }
    c.onKeyDown(event);
  };
  if (c.voice.mode !== "idle") {
    const voice = c.voice;
    return <RecordBar voice={voice} error={c.error} onCancel={c.cancelRecording} onSend={() => void c.sendVoice(voice.mode === "review" ? voice.take : null)} />;
  }
  const mic = c.face === "mic";
  return (
    <form onSubmit={c.submit} className="flex flex-col gap-2" data-composer-surface>
      <ReplyEditBar reply={reply} editing={editing} onCancelReply={onCancelReply} onCancelEdit={onCancelEdit} />
      <FileTray files={c.files} busy={c.busy} progress={c.progress} onRemove={c.removeFile} />
      <MentionList choices={c.choices} pickAt={c.pickAt} onHover={c.setPick} onChoose={c.selectMention} />
      {previewHref && !noPreview ? (
        <div data-link-preview-chip className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p dir="auto" className="truncate font-semibold">
              {ct("chatlp.composer", { host: hostOf(previewHref) ?? "" })}
            </p>
            <p className="text-warn">{ct("chatlp.warn")}</p>
            <p className="text-fg-muted">{ct("chatlp.fix")}</p>
          </div>
          <button type="button" data-link-preview-off aria-label={ct("chatlp.composer_off")} title={ct("chatlp.composer_off")} onClick={() => setPreviewOff(previewHref)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-1 hover:text-fg">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ) : null}
      <div className="relative flex min-w-0 items-end gap-1.5 sm:gap-2">
        {formatting && selected ? <FormatToolbar onAction={applyAction} /> : null}
        <EmojiPopover
          open={emojiOpen}
          onClose={closeEmoji}
          recents={recents}
          onPick={(emoji) => {
            onEmoji(emoji);
          }}
        />
        <Button type="button" variant="ghost" size="icon" data-emoji-toggle aria-label={ct("chatui.composer.emoji")} aria-expanded={emojiOpen} onClick={() => setEmojiOpen((open) => !open)}>
          <span aria-hidden="true" className="text-xl">
            😊
          </span>
        </Button>
        <label className="sr-only" htmlFor="chat-message">
          {ct("chatc.message")}
        </label>
        <textarea
          id="chat-message"
          ref={c.textRef}
          rows={1}
          value={c.body}
          onChange={(event) => c.onTextChange(event.currentTarget.value)}
          onKeyDown={onBoxKeyDown}
          onSelect={(event) => setSelected(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)}
          onBlur={() => setSelected(false)}
          onPaste={c.onPaste}
          role="combobox"
          aria-expanded={c.choices.length > 0}
          aria-controls="chat-mention-list"
          aria-autocomplete="list"
          aria-activedescendant={c.choices.length > 0 ? `chat-mention-${c.pickAt}` : undefined}
          enterKeyHint="send"
          className="max-h-60 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2 text-base"
          placeholder={ct("chatc.message")}
        />
        {!editing ? <AttachMenu items={attachItemsOf(me)} disabled={c.busy} onPick={(id) => (id === "media" ? c.mediaInput.current?.click() : id === "file" ? c.fileInput.current?.click() : c.setPollOpen(true))} /> : null}
        {!editing && me.canRecall ? (
          <Button type="button" variant="ghost" size="icon" data-recall-button aria-label={ct("recall.menu")} title={ct("recall.menu")} onClick={() => c.setRecall({ kind: null, q: "" })}>
            <span aria-hidden="true" className="text-xl">
              ⚡
            </span>
          </Button>
        ) : null}
        <input ref={c.mediaInput} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { c.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
        <input ref={c.fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { c.addFiles(event.currentTarget.files, true); event.currentTarget.value = ""; }} />
        {mic ? (
          <Button
            type="button"
            variant="primary"
            size="icon"
            data-composer-face="mic"
            className="touch-none select-none"
            aria-label={ct("chat.f.record")}
            title={ct("chat.f.hold_to_record")}
            disabled={c.busy}
            onClick={c.onMicClick}
            onPointerDown={c.onMicPointerDown}
          >
            <span aria-hidden="true">🎤</span>
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="icon" data-composer-face={c.face} disabled={!c.canSubmit} aria-label={c.face === "save" ? ct("chatc.save") : c.busy ? ct("chatc.sending") : ct("chatc.send")}>
            <span aria-hidden="true">{c.busy ? "…" : c.face === "save" ? "✓" : "➤"}</span>
          </Button>
        )}
      </div>
      {c.hint ? <CustomerHint hint={c.hint} canProblem={false} /> : null}
      {c.busy && c.files.length === 0 && c.progress.length > 0 ? (
        <p className="text-xs text-fg-muted" role="status">
          {ct("chat.f.uploading")}
        </p>
      ) : null}
      {c.error ? <p role="alert">{c.error}</p> : null}
    </form>
  );
}
