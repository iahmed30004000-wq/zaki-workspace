"use client";

import React from "react";
import { CalendarClock, Camera, Check, Keyboard, LoaderCircle, Mic, Send, Smile, Star, Video, X, Zap } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { CustomerHint } from "@/components/chat/v2/bubble/bubble-extras";
import { AttachMenu } from "@/components/chat/v2/composer/attach-menu";
import { AttachSheet } from "@/components/chat/v2/composer/attach-sheet";
import { EmojiKeyboard, EmojiPopover } from "@/components/chat/v2/composer/emoji-panel";
import { useTgPhone } from "@/components/shell/tg-phone";
import { deleteBack, insertPiece, type TextEdit } from "@/lib/chat/v2/composer/panel-text";
import { FileTray } from "@/components/chat/v2/composer/file-tray";
import { FormatToolbar } from "@/components/chat/v2/composer/format-toolbar";
import { MentionList } from "@/components/chat/v2/composer/mention-list";
import { RecordBar } from "@/components/chat/v2/composer/record-bar";
import { TgRecordBar } from "@/components/chat/v2/composer/tg-record-bar";
import { ScheduledList } from "@/components/chat/v2/composer/scheduled-list";
import { ScheduleDialog } from "@/components/chat/v2/composer/schedule-dialog";
import { SendMenu, sendMenuItemsOf } from "@/components/chat/v2/composer/send-menu";
import { ReplyEditBar } from "@/components/chat/v2/composer/reply-edit-bar";
import { COMPOSER_ICON_BUTTON, ROUND_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ct } from "@/lib/chat/text";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { firstLink, hostOf } from "@/lib/chat/format/links";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { applyFormat, formatActionOf, type FormatAction } from "@/lib/chat/v2/composer/format-keys";
import type { ComposerEngine } from "@/lib/chat/v2/composer/use-composer";
import type { VideoNoteEngine } from "@/lib/chat/v2/video-note/use-video-note";

/** What the surface reads of the engine (a test builds one by hand). */
export type SurfaceEngine = Pick<
  ComposerEngine,
  | "body" | "files" | "busy" | "error" | "progress" | "voice" | "face" | "canSubmit" | "choices" | "pickAt" | "setPick" | "hint"
  | "textRef" | "mediaInput" | "fileInput" | "addFiles" | "removeFile" | "selectMention"
  | "onTextChange" | "onKeyDown" | "onPaste" | "submit" | "cancelRecording" | "sendVoice" | "onMicPointerDown" | "onMicClick"
  | "setPollOpen" | "setRecall"
> &
  /** C3c.2: «ابعت بدون صوت» (the send button's menu); an engine without them (a test's) draws no menu */
  Partial<Pick<ComposerEngine, "submitSilent" | "silentSendOn" | "setFeedback">> &
  /** «نص مباشر أثناء التسجيل»: the live words of the recorder bar; an engine without it (a test's, or the switch off) draws none */
  Partial<Pick<ComposerEngine, "live">> &
  /** «تيليجرام على التلفون» (`tgPhone`, a phone-wide screen): the phone's recording bar, the tooltip under a short tap and the mic's morph; absent: as before */
  Partial<Pick<ComposerEngine, "tg">> &
  /** S6.2: the attach sheet's edit and «جودة عالية» buttons; an engine without them (a test's) draws neither */
  Partial<Pick<ComposerEngine, "replaceFile" | "setHd" | "addDropped">> &
  /** C3c.3: «جدول الإرسال» (the menu's entry, the calendar icon, the two dialogs); an engine without them (a test's) draws none of it */
  Partial<Pick<ComposerEngine, "scheduling" | "scheduledCount" | "scheduledItems" | "scheduledZone" | "scheduleDialog" | "closeScheduleDialog" | "openScheduleDialog" | "scheduleNow" | "saveScheduledEdit" | "scheduledOpen" | "setScheduledOpen" | "scheduledBusy" | "scheduledError" | "scheduleNotice" | "beginEditScheduled" | "sendScheduledNow" | "deleteScheduled">>;

export interface SurfaceProps {
  c: SurfaceEngine;
  me: { canPoll?: boolean; canLocation?: boolean; canRecall?: boolean; recallKinds?: readonly string[] };
  reply: MessageDto | null;
  /** S5.7 «رد بالاقتباس»: the piece of `reply` the person picked (the bar shows it in place of the whole message) */
  replyQuote?: string | null;
  editing: MessageDto | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  recents: string[];
  onEmoji: (emoji: string) => void;
  /** the company's switch `chatFormatting` (C3b.1; absent: on): off, no toolbar over the selection and no formatting shortcut */
  formatting?: boolean;
  /** the company's switch `zakiEmojis` (the composer passes the header's answer; absent: off): on, the emoji picker's first tab is the Zaki stickers */
  zakiEmojis?: boolean;
  /** «شكل تيليجرام» (`tgLook`; absent: off): the paperclip opens the attach sheet (picked files as a numbered grid, caption, send with a count, the glass bar of kinds) instead of the little menu */
  attachSheet?: boolean;
  /** the company's switch `linkPreviews` (C3b.2; absent: on): off, the line about the link's preview is not drawn */
  linkPreviews?: boolean;
  /**
   * C3b.2: the person pressed ✕ on the preview of the link in the box (`true`), or the link changed or went (`false`): the send must carry `noPreview` while it is
   * `true`, and the server then never visits the link. The surface only reports it; the composer that sends (`useComposer`) reads it.
   */
  onNoPreviewChange?: (noPreview: boolean) => void;
  /** «تيليجرام على التلفون»: an emoji picked in the inline panel (it is remembered as a recent one) */
  onEmojiUsed?: (emoji: string) => void;
  /** «تيليجرام على التلفون»: a sticker of the panel's «الملصقات» tab, sent by itself (only while the box is empty) */
  onStickerSend?: (code: string) => void;
  /** «تيليجرام على التلفون»: the reply bar was tapped: «خيارات الرد» */
  onReplyOptions?: () => void;
  /** «رسالة فيديو دائرية» (its own engine, `useVideoNote`); absent or not `enabled`: the microphone is exactly what it was */
  videoNote?: Pick<VideoNoteEngine, "enabled" | "captureMode" | "tip" | "error" | "state" | "swallowsClick" | "watchMicTap" | "onCameraPointerDown" | "onCameraClick" | "startLocked">;
  /** «صور متحركة»: the picker's GIF tab (it closes the picker after a send); absent (the switch off, or while an edit is typed): the picker has no such tab */
  gifPanel?: (close: () => void) => React.ReactNode;
}

/**
 * C2.5 — the composer as it is drawn: a pill `[smile] [ textarea ] [clip] [bolt]` and, after it, the one round button `[mic ⇄ send]` under the reply / edit bar, the tray, the customer-data line and the «@» list.
 * The round button is the microphone while the box is empty, send when there is text or a file, save while an edit is typed (`composerFaceOf`). While a voice
 * note is recorded the whole row is the record bar. Everything it shows comes from the engine; it holds only whether the emoji picker is open.
 */
export function ComposerSurface({ c, me, reply, replyQuote = null, editing, onCancelReply, onCancelEdit, recents, onEmoji, formatting = true, linkPreviews = true, zakiEmojis = false, attachSheet = false, onNoPreviewChange, onEmojiUsed, onStickerSend, onReplyOptions, videoNote, gifPanel }: SurfaceProps) {
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  // «تيليجرام على التلفون»: the emojis stand where the keyboard stood (the box is NOT focused while they do), and the caret is kept by hand
  const tg = useTgPhone();
  const panelCaret = React.useRef<{ start: number; end: number } | null>(null);
  const toggleEmoji = () => {
    if (!tg) return setEmojiOpen((open) => !open);
    const el = c.textRef.current;
    if (emojiOpen) {
      setEmojiOpen(false);
      el?.focus();
      return;
    }
    panelCaret.current = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    el?.blur();
    setEmojiOpen(true);
  };
  const panelEdit = (edit: (text: string, start: number, end: number) => TextEdit) => {
    const at = panelCaret.current ?? { start: c.body.length, end: c.body.length };
    // an empty box (the message was just sent) puts the caret back at its start
    const next = edit(c.body, Math.min(at.start, c.body.length), Math.min(at.end, c.body.length));
    panelCaret.current = { start: next.caret, end: next.caret };
    c.onTextChange(next.text);
  };
  const panelInsert = (piece: string) => {
    onEmojiUsed?.(piece);
    panelEdit((text, start, end) => insertPiece(text, start, end, piece));
  };
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
  // the phone's two small motions: the box fading back after the recording bar, and the round button's icon morphing when it changes
  const cameBack = React.useRef(false);
  const firstFace = React.useRef(c.face);
  const faceMoved = React.useRef(false);
  if (c.face !== firstFace.current) faceMoved.current = true;
  const faceChanged = faceMoved.current;
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
    const send = () => void c.sendVoice(voice.mode === "review" ? voice.take : null);
    cameBack.current = true;
    if (c.tg) return <TgRecordBar voice={voice} error={c.error} live={c.live} tg={c.tg} onSend={send} />;
    return <RecordBar voice={voice} error={c.error} live={c.live} onCancel={c.cancelRecording} onSend={send} />;
  }
  const mic = c.face === "mic";
  // «رسالة فيديو دائرية»: under Telegram's phone look a tap turns the round button into the camera (and back); elsewhere the camera is a button of its own in the pill
  const video = videoNote?.enabled === true && !editing ? videoNote : null;
  const cameraFace = mic && video !== null && c.tg !== undefined && video.captureMode === "video";
  const tipKey = video && c.tg ? (video.tip || c.tg.tip ? (video.captureMode === "video" ? "tgstories.videonote.tip_video" : "tgstories.videonote.tip_voice") : null) : c.tg?.tip ? "tgvoice.tap_tip" : null;
  // the microphone and send morph into each other (150 ms); nothing morphs on the first drawing of the box
  const morph = c.tg && faceChanged ? "tg-face-morph" : "";
  // C3c.2: the send button's menu (right-click, long press): only an engine that can send silently, only while the company's switch is on (absent: on)
  // C3c.3: and «جدول الإرسال», only where the scheduled list said the person may write here (the company's switch on)
  const sendItems = c.submitSilent || c.scheduling ? sendMenuItemsOf({ silentSend: c.submitSilent !== undefined && c.silentSendOn !== false, editing: editing !== null, canSubmit: c.canSubmit, scheduling: c.scheduling === true }) : [];
  const scheduledCount = c.scheduledCount ?? c.scheduledItems?.length ?? 0;
  const dialogEdit = c.scheduleDialog?.edit ?? null;
  return (
    <>
    <form onSubmit={c.submit} className={`mx-auto flex w-full max-w-[904px] flex-col gap-2${c.tg && cameBack.current ? " tg-composer-return" : ""}`} style={c.tg ? (tgMotionVars(["composerMorphMs", "composerReturnMs"]) as React.CSSProperties) : undefined} data-composer-surface>
      <ReplyEditBar reply={reply} editing={editing} quote={replyQuote} onCancelReply={onCancelReply} onCancelEdit={onCancelEdit} {...(onReplyOptions ? { onOptions: onReplyOptions } : {})} />
      <FileTray files={c.files} busy={c.busy} progress={c.progress} onRemove={c.removeFile} />
      <MentionList choices={c.choices} pickAt={c.pickAt} onHover={c.setPick} onChoose={c.selectMention} />
      {previewHref && !noPreview ? (
        <div data-link-preview-chip className="flex items-start gap-2 rounded-xl bg-surface-1 px-3 py-1.5 text-xs shadow-card">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p dir="auto" className="truncate font-semibold">
              {ct("chatlp.composer", { host: hostOf(previewHref) ?? "" })}
            </p>
            <p className="text-warn">{ct("chatlp.warn")}</p>
            <p className="text-fg-muted">{ct("chatlp.fix")}</p>
          </div>
          <button type="button" data-link-preview-off aria-label={ct("chatlp.composer_off")} title={ct("chatlp.composer_off")} onClick={() => setPreviewOff(previewHref)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      ) : null}
      <div data-composer-row="" className="relative flex min-w-0 items-end gap-2">
        {formatting && selected ? <FormatToolbar onAction={applyAction} /> : null}
        {tg ? null : (
        <EmojiPopover
          open={emojiOpen}
          onClose={closeEmoji}
          recents={recents}
          zaki={zakiEmojis}
          {...(gifPanel && !editing ? { gifs: gifPanel(closeEmoji) } : {})}
          onPick={(emoji) => {
            onEmoji(emoji);
          }}
        />
        )}
        <div data-composer-pill className="flex min-w-0 flex-1 items-end rounded-[23px] bg-surface-1 px-1 py-[3px] shadow-card">
        <button type="button" data-emoji-toggle className={COMPOSER_ICON_BUTTON} aria-label={ct(tg && emojiOpen ? "tgmsg.panel.keyboard" : "chatui.composer.emoji")} aria-expanded={emojiOpen} onClick={toggleEmoji}>
          {tg && emojiOpen ? <Keyboard aria-hidden="true" className="size-6" /> : <Smile aria-hidden="true" className="size-6" />}
        </button>
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
          // a tap in the box brings the phone's keyboard back in the panel's place
          {...(tg && emojiOpen ? { onFocus: closeEmoji } : {})}
          onPaste={c.onPaste}
          role="combobox"
          aria-expanded={c.choices.length > 0}
          aria-controls="chat-mention-list"
          aria-autocomplete="list"
          aria-activedescendant={c.choices.length > 0 ? `chat-mention-${c.pickAt}` : undefined}
          enterKeyHint="send"
          className="max-h-60 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[11px] text-base leading-[1.45] text-fg outline-none placeholder:text-fg-muted md:min-h-10 md:py-[9px]"
          placeholder={ct("chatc.message")}
        />
        {!editing && attachSheet ? (
          <AttachSheet
            items={attachItemsOf(me)}
            disabled={c.busy}
            files={c.files}
            busy={c.busy}
            caption={c.body}
            canSend={c.canSubmit}
            onCaption={c.onTextChange}
            onRemove={c.removeFile}
            onEdit={c.replaceFile}
            onHd={c.setHd}
            onSend={() => c.submit()}
            onDropFiles={(files) => c.addDropped?.(files, false)}
            onPick={(id) => (id === "media" ? c.mediaInput.current?.click() : id === "file" ? c.fileInput.current?.click() : c.setPollOpen(true))}
          />
        ) : null}
        {!editing && !attachSheet ? <AttachMenu items={attachItemsOf(me)} disabled={c.busy} onPick={(id) => (id === "media" ? c.mediaInput.current?.click() : id === "file" ? c.fileInput.current?.click() : c.setPollOpen(true))} /> : null}
        {mic && video && !c.tg ? (
          <button type="button" data-video-note-button className={COMPOSER_ICON_BUTTON} aria-label={ct("tgstories.videonote.record")} title={ct("tgstories.videonote.record")} disabled={c.busy} onClick={video.startLocked}>
            <Video aria-hidden="true" className="size-6" />
          </button>
        ) : null}
        {!editing && scheduledCount > 0 ? (
          <button type="button" data-sched-icon className={COMPOSER_ICON_BUTTON} aria-label={ct("chatsched.icon", { n: scheduledCount })} title={ct("chatsched.icon", { n: scheduledCount })} onClick={() => c.setScheduledOpen?.(true)}>
            <CalendarClock aria-hidden="true" className="size-6" />
          </button>
        ) : null}
        {!editing && me.canRecall ? (
          <button type="button" data-recall-button className={COMPOSER_ICON_BUTTON} aria-label={ct("recall.menu")} title={ct("recall.menu")} onClick={() => c.setRecall({ kind: null, q: "" })}>
            <Zap aria-hidden="true" className="size-6" />
          </button>
        ) : null}
        {!editing && me.canRecall && me.recallKinds?.includes("product") && c.setFeedback ? (
          <button type="button" data-feedback-button className={COMPOSER_ICON_BUTTON} aria-label={ct("chatui.feedback.button")} title={ct("chatui.feedback.button")} onClick={() => c.setFeedback?.({ q: "" })}>
            <Star aria-hidden="true" className="size-6" />
          </button>
        ) : null}
        </div>
        <input ref={c.mediaInput} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { c.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
        <input ref={c.fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { c.addFiles(event.currentTarget.files, true); event.currentTarget.value = ""; }} />
        {tipKey ? (
          <p role="tooltip" data-mic-tip className="pointer-events-none absolute bottom-full end-0 z-20 mb-2 max-w-[85%] rounded-xl bg-fg px-3 py-2 text-xs font-medium text-surface shadow-lg">
            {ct(tipKey)}
          </p>
        ) : null}
        {cameraFace ? (
          // a key of its own: the button that was tapped leaves the page, so its click is not handed to the one that took its place
          <button
            key="camera"
            type="button"
            data-composer-face="camera"
            className={`${ROUND_BUTTON} touch-none select-none [-webkit-touch-callout:none]`}
            aria-label={ct("tgstories.videonote.record")}
            title={ct("tgstories.videonote.record")}
            disabled={c.busy}
            onClick={video.onCameraClick}
            onPointerDown={video.onCameraPointerDown}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Camera aria-hidden="true" className="size-6" />
          </button>
        ) : mic ? (
          <button
            key="mic"
            type="button"
            data-composer-face="mic"
            className={`${ROUND_BUTTON} touch-none select-none${c.tg ? " [-webkit-touch-callout:none]" : ""}`}
            aria-label={ct("chat.f.record")}
            title={ct("chat.f.hold_to_record")}
            disabled={c.busy}
            onClick={video ? () => (video.swallowsClick() ? undefined : c.onMicClick()) : c.onMicClick}
            onPointerDown={
              video && c.tg
                ? (event) => {
                    video.watchMicTap(event);
                    c.onMicPointerDown(event);
                  }
                : c.onMicPointerDown
            }
            // a long press on a phone must not open the browser's own menu in the middle of a hold
            onContextMenu={c.tg ? (event) => event.preventDefault() : undefined}
          >
            <Mic key="mic" aria-hidden="true" className={morph ? `size-6 ${morph}` : "size-6"} />
          </button>
        ) : (
          <SendMenu items={sendItems} onPick={(id) => (id === "silent" ? c.submitSilent?.() : id === "schedule" ? c.openScheduleDialog?.() : undefined)}>
            <button type="submit" data-composer-face={c.face} className={ROUND_BUTTON} disabled={!c.canSubmit} aria-label={c.face === "save" ? ct("chatc.save") : c.busy ? ct("chatc.sending") : ct("chatc.send")}>
              {c.busy ? <LoaderCircle aria-hidden="true" className="size-6 motion-safe:animate-spin" /> : c.face === "save" ? <Check key="save" aria-hidden="true" className={morph ? `size-6 ${morph}` : "size-6"} /> : <Send key="send" aria-hidden="true" className={morph ? `size-6 ${morph}` : "size-6"} />}
            </button>
          </SendMenu>
        )}
      </div>
      {tg && emojiOpen ? (
        <EmojiKeyboard
          recents={recents}
          zaki={zakiEmojis}
          onEmoji={panelInsert}
          onSticker={(code) => (onStickerSend && !editing && !c.body.trim() ? onStickerSend(code) : panelEdit((text, start, end) => insertPiece(text, start, end, code)))}
          onBackspace={() => panelEdit(deleteBack)}
          {...(gifPanel && !editing ? { gifs: gifPanel(closeEmoji) } : {})}
        />
      ) : null}
      {c.hint ? <CustomerHint hint={c.hint} canProblem={false} /> : null}
      {c.busy && c.files.length === 0 && c.progress.length > 0 ? (
        <p className="text-xs text-fg-muted" role="status">
          {ct("chat.f.uploading")}
        </p>
      ) : null}
      {c.error ? <p role="alert">{c.error}</p> : null}
      {video && video.state.mode === "idle" && video.error ? <p role="alert">{video.error}</p> : null}
      {c.scheduleNotice ? (
        <p role="status" className="text-xs text-fg-muted" data-sched-notice>
          {c.scheduleNotice}
        </p>
      ) : null}
    </form>
    {/* C3c.3: the two dialogs sit NEXT TO the form, not inside it: a dialog's own submit never reaches the composer's */}
    {c.scheduleDialog && c.scheduleNow && c.saveScheduledEdit && c.closeScheduleDialog ? (
      <ScheduleDialog
        open
        onClose={c.closeScheduleDialog}
        timeZone={c.scheduledZone ?? "UTC"}
        hasFiles={dialogEdit ? dialogEdit.attachmentIds.length > 0 : c.files.length > 0}
        edit={dialogEdit ? { body: dialogEdit.body, sendAt: dialogEdit.sendAt } : null}
        onSubmit={(input) => (dialogEdit ? c.saveScheduledEdit!(dialogEdit, input) : c.scheduleNow!(input))}
      />
    ) : null}
    {c.scheduledOpen && c.setScheduledOpen && c.sendScheduledNow && c.beginEditScheduled && c.deleteScheduled ? (
      <ScheduledList
        open
        onClose={() => c.setScheduledOpen?.(false)}
        items={c.scheduledItems ?? []}
        timeZone={c.scheduledZone ?? "UTC"}
        busyId={c.scheduledBusy ?? null}
        error={c.scheduledError ?? ""}
        onSendNow={c.sendScheduledNow}
        onEdit={c.beginEditScheduled}
        onDelete={c.deleteScheduled}
      />
    ) : null}
    </>
  );
}
