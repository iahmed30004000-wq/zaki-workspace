"use client";

import React from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";
import type { ScheduledAnswer, ScheduledItem } from "@/components/chat/v2/composer/scheduled-list";
import { editChangesTime, type ScheduleSubmit } from "@/components/chat/v2/composer/schedule-dialog";
import type { OutboxRestore } from "@/components/chat/composer/chat-composer";
import { dropStalePending, replacePending, syncPendingWithOutbox } from "@/lib/chat/cache/pending";
import { clearComposerDraft, loadComposerDraft, saveComposerDraft } from "@/lib/chat/composer-draft";
import { compressImage, HIGH_MAX_SIDE, maxSideFor } from "@/lib/chat/compress-image";
import { readDevicePrefs } from "@/lib/device-prefs";
import { sendKeyAllows } from "@/lib/chat/prefs";
import { isSavedHeader } from "@/lib/chat/v2/menu/menu-context";
import { scheduledPlanOf } from "@/lib/chat/v2/composer/scheduled-plan";
import { createChatUploadFormData, createVoiceUploadFormData, enterSends, messageClientId } from "@/lib/chat/conversation/client";
import { DEFAULT_DICTATION_LANG, browserRecognition, createDictation, dictationText, type DictationSnapshot } from "@/lib/chat/v2/dictation";
import { ASSISTANT_MENTION_ID, filterMentionChoices, findMentionQuery, insertMention, MENTION_ALL_NAME, mentionsAll, selectedMentionIds } from "@/lib/chat/conversation/mentions";
import { classifyFile, exceedsKindLimit, MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/chat/file-kinds";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { takeRoom } from "@/lib/chat/album-layout";
import { startOptimisticSend } from "@/lib/chat/outbox/optimistic";
import type { Outbox } from "@/lib/chat/outbox/queue";
import { postChatMessage, SEND_TIMEOUT_MS, type ChatSendPayload } from "@/lib/chat/outbox/send";
import { slashCommand, type RecallKind } from "@/lib/chat/recall-client";
import { feedbackCommand } from "@/lib/chat/v2/feedback/feedback-model";
import { playChatSound } from "@/lib/chat/sounds";
import { ct } from "@/lib/chat/text";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { composerFaceOf, canSubmitNow } from "@/lib/chat/v2/composer/face";
import { failMessageOf } from "@/lib/chat/v2/composer/fail-text";
import { forDropMode, pastedDocuments, pastedImages, type DroppedFile } from "@/lib/chat/v2/composer/clipboard-files";
import { holdOutcome } from "@/lib/chat/v2/composer/hold-gesture";
import { arrowUpEdits } from "@/lib/chat/v2/composer/edit-last";
import { composerHintOf } from "@/lib/chat/v2/composer/hint";
import type { MentionChoice, PendingFile, VoiceState } from "@/lib/chat/v2/composer/types";
import { VoiceRecorder, type VoiceTake } from "@/lib/chat/voice-recorder";
import { useTyping } from "@/lib/realtime/use-realtime";

/**
 * C2.5 — THE ENGINE of the new composer. It does what `ChatComposer` does (the old screen keeps that component as it is) with the same pieces and no second
 * copy of any of them: the draft (`composer-draft.ts`), the optimistic send and the outbox (`startOptimisticSend`, `postChatMessage`, `Outbox`), the upload
 * (`uploadWithProgress`, `compressImage`), the recorder (`VoiceRecorder`), the mentions (`conversation/mentions.ts`) and the «/» command (`recall-client.ts`).
 * What it adds: paste and drop, the hold-slide-lock gesture, the one-click recording on the computer, Esc, «↑» to edit my last message, the emoji inserted at
 * the caret, and the customer-data line while typing.
 *
 * The server still decides every send. A plain text is optimistic (C1.8) and goes through the outbox; files, a voice note and a poll keep the old flow (their
 * upload progress is the feedback). A retry can never send twice: the `clientId` is renewed only when what is being sent changes.
 */
export interface ComposerParams {
  conversationId: string;
  detail: ConversationDto;
  onMessage: (message: MessageDto) => void;
  reply: MessageDto | null;
  onCancelReply: () => void;
  editing: MessageDto | null;
  onCancelEdit: () => void;
  onEdited: (message: MessageDto) => void;
  outbox: Outbox | null;
  restore: OutboxRestore | null;
  onRestored: () => void;
  optimistic: { qc: QueryClient } | null;
  /** «↑» in an empty box: the host finds my last text message and starts its edit (the pane's `startEdit`) */
  editLast?: () => void;
}

const failText = (e: unknown, fallback: string): string => failMessageOf(e, fallback, ct);

export function useComposer(p: ComposerParams) {
  const { conversationId, detail, onMessage, reply, onCancelReply, editing, onCancelEdit, onEdited, outbox, restore, onRestored, optimistic, editLast } = p;
  const { notifyTyping } = useTyping(conversationId);
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [mentions, setMentions] = React.useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState<number[]>([]);
  const [voice, setVoice] = React.useState<VoiceState>({ mode: "idle" });
  const [clientId, setClientId] = React.useState(() => messageClientId());
  const [pollOpen, setPollOpen] = React.useState(false);
  /** C3b.2: ✕ was pressed on the preview of the link in the box (the surface reports it): the send carries `noPreview` and the server never visits the link */
  const [noPreview, setNoPreview] = React.useState(false);
  const [recall, setRecall] = React.useState<{ kind: RecallKind | null; q: string } | null>(null);
  /** C3w.2 (Q1.3): «/آراء حراك» (or the button beside «⚡») opens the customers' feedback picker; `q` is what was typed after the word */
  const [feedback, setFeedback] = React.useState<{ q: string } | null>(null);
  // C3c.3 «جدول الإرسال»: the person's own scheduled messages of this conversation (null: not loaded, the company's switch is off, or they may not schedule here), the two dialogs, and what an action says
  const [scheduledList, setScheduledList] = React.useState<ScheduledAnswer | null>(null);
  const [scheduleDialog, setScheduleDialog] = React.useState<{ edit: ScheduledItem | null } | null>(null);
  const [scheduledOpen, setScheduledOpen] = React.useState(false);
  const [scheduledBusy, setScheduledBusy] = React.useState<string | null>(null);
  const [scheduledError, setScheduledError] = React.useState("");
  const [scheduleNotice, setScheduleNotice] = React.useState("");
  /** the id of THIS scheduling: a retry of a request whose answer was lost finds the same row; renewed after a row was made */
  const scheduleKey = React.useRef(messageClientId());
  /** the files already uploaded for this scheduling: a retry after a refusal (a time too soon ...) reuses them instead of uploading and orphaning a second copy */
  const scheduleUploads = React.useRef<{ files: File[]; ids: string[] } | null>(null);
  /** the images of a paste, waiting in the send dialog */
  const [pasted, setPasted] = React.useState<File[] | null>(null);
  const recorder = React.useRef<VoiceRecorder | null>(null);
  const releaseHold = React.useRef<(() => void) | null>(null);
  const textRef = React.useRef<HTMLTextAreaElement | null>(null);
  const mediaInput = React.useRef<HTMLInputElement | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  // who «@» offers: everybody the conversation reaches (an open topic: its whole space), never myself; «@الكل» first where I may use it
  const memberOptions = (detail.mentionables ?? detail.members ?? []).filter((m) => m.id !== detail.me.id);
  const activeMention = findMentionQuery(body);
  const query = activeMention?.query ?? "";
  const canAll = Boolean(detail.me.canMentionAll);
  const [pick, setPick] = React.useState(0);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const people = activeMention && dismissed !== body ? filterMentionChoices(memberOptions, query) : [];
  const offerAll = Boolean(activeMention) && dismissed !== body && canAll && filterMentionChoices([{ name: MENTION_ALL_NAME }], query).length > 0;
  const choices: MentionChoice[] = [...(offerAll ? [{ id: "*", name: MENTION_ALL_NAME, all: true }] : []), ...people];
  const pickAt = Math.min(pick, Math.max(0, choices.length - 1));
  React.useEffect(() => {
    setPick(0);
  }, [query]);

  // previews are object URLs: give them back when the file leaves the tray, and when the screen goes; never leave the microphone or a hold open behind a closed conversation
  const filesRef = React.useRef(files);
  filesRef.current = files;
  React.useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
      releaseHold.current?.();
      recorder.current?.cancel();
    },
    [],
  );

  // the unsent words of this conversation survive a navigation, a reload and a closed tab; the outbox switch off: no draft is kept
  const meId = detail.me.id ?? "";
  const draftOn = detail.chatOutbox !== false && !detail.me.oversight && meId !== "";
  const membersRef = React.useRef(memberOptions);
  membersRef.current = memberOptions;
  function keepDraft(nextBody: string, nextMentions: Array<{ id: string; name: string }>) {
    if (draftOn && !editing) saveComposerDraft(meId, conversationId, { body: nextBody, mentions: nextMentions.map((m) => m.id) });
  }
  const knownMention = (id: string) => membersRef.current.find((x) => x.id === id);
  React.useEffect(() => {
    if (editing) {
      setBody(editing.body ?? "");
    } else {
      const draft = draftOn ? loadComposerDraft(meId, conversationId) : null;
      setBody(draft ? draft.body : "");
      if (draft) setMentions(draft.mentions.flatMap((id) => { const m = knownMention(id); return m ? [{ id: m.id, name: m.name }] : []; }));
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box is re-read when the edit, the conversation or the person changes
  }, [editing, conversationId, meId, draftOn]);
  // an edit that starts puts the cursor in the box
  React.useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);
  // «عدّل» on a message that failed for good: its words come back to the box (after what is already typed there)
  React.useEffect(() => {
    if (!restore) return;
    const next = body.trim() ? `${body}\n${restore.body}` : restore.body;
    const restored = restore.mentions.flatMap((id) => { const m = knownMention(id); return m ? [{ id: m.id, name: m.name }] : []; });
    const nextMentions = [...mentions, ...restored.filter((r) => !mentions.some((m) => m.id === r.id))];
    setClientId(messageClientId());
    setBody(next);
    setMentions(nextMentions);
    keepDraft(next, nextMentions);
    textRef.current?.focus();
    onRestored();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per restored message
  }, [restore]);

  // C1.8: the bubbles of this conversation follow the outbox (a refusal turns one red, a retry gives it its clock back, an answer settles it); a copy the device
  // brought back after a reload is a ghost and goes. Keyed on the QueryClient, not on the prop object.
  const optimisticQc = optimistic?.qc ?? null;
  React.useEffect(() => {
    if (!optimisticQc || !outbox) return;
    const qc = optimisticQc;
    const sync = () => syncPendingWithOutbox(qc, conversationId, outbox.forConversation(conversationId));
    dropStalePending(qc, conversationId, outbox.forConversation(conversationId).map((i) => i.clientId));
    sync();
    const offSent = outbox.onSent((item, message) => {
      if (item.conversationId === conversationId) replacePending(qc, conversationId, message);
    });
    const offChange = outbox.subscribe(sync);
    return () => {
      offSent();
      offChange();
    };
  }, [optimisticQc, outbox, conversationId]);

  // ---------- the tray ----------
  function addFiles(list: ArrayLike<File> | DroppedFile[] | null, asFileDefault = false) {
    if (!list || editing) return;
    // C3b.3: ONE message carries at most ten files with ONE caption: what does not fit is left out now, and the person is told now (not after the upload)
    const { accepted, dropped } = takeRoom(filesRef.current.length, Array.from(list as ArrayLike<File | DroppedFile>));
    if (dropped > 0) setError(ct("chatc.too_many_files"));
    const incoming = accepted.map((entry) => {
      const { file, asFile } = "file" in entry ? entry : { file: entry, asFile: asFileDefault };
      const kind = classifyFile(file);
      return { file, kind, asFile, preview: kind === "IMAGE" || kind === "VIDEO" ? URL.createObjectURL(file) : null } satisfies PendingFile;
    });
    if (incoming.length) setClientId(messageClientId());
    // the tray's own ref moves at once: a second pick in the same breath counts the first one
    filesRef.current = [...filesRef.current, ...incoming];
    setFiles((current) => [...current, ...incoming]);
  }
  function removeFile(index: number) {
    setClientId(messageClientId());
    setFiles((current) => {
      const gone = current[index];
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return current.filter((_, i) => i !== index);
    });
  }
  /** The editor's result takes the place of the file at `index` (same place in the tray, same choice of quality): the old preview is let go, the new one made. */
  function replaceFile(index: number, file: File) {
    setClientId(messageClientId());
    setFiles((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        if (item.preview) URL.revokeObjectURL(item.preview);
        const kind = classifyFile(file);
        return { ...item, file, kind, preview: kind === "IMAGE" || kind === "VIDEO" ? URL.createObjectURL(file) : null };
      }),
    );
  }
  /** «جودة عالية» for one picture of the tray. */
  function setHd(index: number, on: boolean) {
    setFiles((current) => current.map((item, i) => (i === index ? { ...item, hd: on } : item)));
  }
  function selectMention(id: string, name: string) {
    setClientId(messageClientId());
    const nextBody = insertMention(body, name);
    setBody(nextBody);
    if (id === "*" || id === ASSISTANT_MENTION_ID) { keepDraft(nextBody, mentions); return; } // «@الكل» and «@المساعد» are read from the words at send time, they are no person
    const nextMentions = mentions.some((m) => m.id === id) ? mentions : [...mentions, { id, name }];
    setMentions(nextMentions);
    keepDraft(nextBody, nextMentions);
  }
  /** the emoji goes where the caret is (and at the end when the box has no caret yet) */
  function insertAtCaret(text: string) {
    const el = textRef.current;
    const start = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setClientId(messageClientId());
    setBody(next);
    keepDraft(next, mentions);
    if (!editing && next.trim()) notifyTyping();
    const caret = start + text.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  // ---------- sending ----------
  /** Keep a message in the outbox (the pending bubble appears from there). A full outbox is a clear error and the text stays in the box. */
  function keep(queue: Outbox, payload: ChatSendPayload, retryAfterSec?: number) {
    const result = queue.enqueue(
      {
        clientId: payload.clientId, conversationId, body: payload.body.trim(), mentions: payload.mentions,
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
        ...(payload.attachmentIds.length ? { attachmentIds: payload.attachmentIds } : {}),
        ...(payload.mentionAll ? { mentionAll: true } : {}),
        ...(payload.noPreview ? { noPreview: true } : {}),
        ...(payload.silent ? { silent: true } : {}),
      },
      Date.now(),
      retryAfterSec !== undefined ? { retryAfterSec } : {},
    );
    if (!result.ok) throw new Error(ct("outbox.full"));
  }

  /**
   * Send one message. Through the outbox (a text, or a text with files already uploaded) when the network is gone or answers 502/503/504, or when this
   * conversation already has messages waiting (they leave first: the order is kept); a voice note is never queued (`queueable` false).
   */
  async function postMessage(payload: ChatSendPayload, queueable = true) {
    const queue = queueable ? outbox : null;
    if (queue) {
      const waiting = queue.forConversation(conversationId).some((i) => !i.failed);
      if (waiting || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        keep(queue, payload);
        if (waiting) void queue.flush({ force: true });
        return;
      }
    }
    const outcome = await postChatMessage(conversationId, payload, undefined, queue ? SEND_TIMEOUT_MS : 0);
    if (outcome.kind === "sent") {
      onMessage(outcome.message);
      playChatSound("sent");
      return;
    }
    if (queue && outcome.kind === "transient") return keep(queue, payload);
    if (queue && outcome.kind === "limited") return keep(queue, payload, outcome.retryAfterSec);
    throw new Error(outcome.kind === "refused" ? ct(outcome.failure.key) : ct("chatc.message_failed"));
  }

  async function saveEdit() {
    if (busy || !editing || !body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/messages/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: body.trim() }) });
      if (!response.ok) throw new Error(ct("chatc.message_failed"));
      onEdited((await response.json()) as MessageDto);
    } catch (e) {
      setError(failText(e, "chatc.message_failed"));
    } finally {
      setBusy(false);
    }
  }

  /** Uploads the tray's files one after the other (the progress of each) and answers their ids, in order (C3c.3 shares it with «جدول الإرسال»: the same upload, the same limits). */
  async function uploadTray(tray: PendingFile[]): Promise<string[]> {
    const attachmentIds: string[] = [];
    for (const [index, item] of tray.entries()) {
      let upload = item.file;
      // «ابعتها كملف»: the original bytes, never compressed
      if (item.kind === "IMAGE" && !item.asFile) {
        const compressed = await compressImage(item.file, item.file.name, item.hd ? { maxSide: HIGH_MAX_SIDE } : { maxSide: maxSideFor(readDevicePrefs().imageQuality) });
        if (compressed) upload = new File([compressed.blob], item.file.name, { type: compressed.mime });
      }
      if (exceedsKindLimit(upload.size, item.kind)) throw new Error(ct("chatc.file_too_large"));
      const result = await uploadWithProgress("/api/chat/uploads", createChatUploadFormData(upload, item.asFile ? "FILE" : item.kind), (percent) =>
        setProgress((current) => current.map((v, i) => (i === index ? percent : v))),
      );
      if (typeof result["id"] !== "string") throw new Error(ct("chatc.upload_failed"));
      attachmentIds.push(result["id"]);
    }
    return attachmentIds;
  }

  /** The send itself, for the words and the tray it is given (the box's own, or a paste dialog's). */
  async function sendNow(text: string, tray: PendingFile[], id: string = clientId) {
    return sendWith(text, tray, id, false);
  }
  /** `sendNow` with the choice of C3c.2's «ابعت بدون صوت»: `silent` sends the message with no bell, push or sound for anybody (and keeps it silent through the outbox's retries). */
  async function sendWith(text: string, tray: PendingFile[], id: string, silent: boolean) {
    if (busy || (!text.trim() && !tray.length)) return;
    // C1.8: a plain text is drawn first and sent behind the bubble; the box is free at once (nothing to wait for, no upload)
    if (optimistic && outbox && draftOn && !tray.length) {
      const me = (detail.members ?? detail.mentionables ?? []).find((m) => m.id === meId);
      const started = startOptimisticSend(
        { qc: optimistic.qc, outbox },
        {
          conversationId,
          payload: { body: text.trim(), attachmentIds: [], mentions: selectedMentionIds(text, mentions), ...(canAll && mentionsAll(text) ? { mentionAll: true } : {}), ...(reply ? { replyToId: reply.id } : {}), ...(noPreview ? { noPreview: true } : {}), ...(silent ? { silent: true } : {}), clientId: id },
          author: { id: meId, name: me?.name ?? "", avatar: me?.avatarUrl ?? null },
          ...(reply ? { replyTo: { id: reply.id, preview: reply.deleted ? null : reply.body, authorName: reply.authorName } } : {}),
        },
      );
      if (started.shown) {
        clearComposerDraft(meId, conversationId);
        setBody("");
        setMentions([]);
        setClientId(messageClientId());
        setError("");
        onCancelReply();
        void started.done.then((outcome) => {
          if (outcome.kind === "sent") {
            onMessage(outcome.message);
            playChatSound("sent");
          }
        });
        return;
      }
    }
    if (tray.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(ct("chatc.too_many_files"));
      return;
    }
    setBusy(true);
    setError("");
    setProgress(tray.map(() => 0));
    try {
      const attachmentIds = await uploadTray(tray);
      await postMessage({ body: text.trim(), attachmentIds, mentions: selectedMentionIds(text, mentions), ...(canAll && mentionsAll(text) ? { mentionAll: true } : {}), ...(reply ? { replyToId: reply.id } : {}), ...(noPreview ? { noPreview: true } : {}), ...(silent ? { silent: true } : {}), clientId: id });
      for (const f of tray) if (f.preview) URL.revokeObjectURL(f.preview);
      if (draftOn) clearComposerDraft(meId, conversationId);
      setBody("");
      setFiles([]);
      setMentions([]);
      setClientId(messageClientId());
      onCancelReply();
    } catch (e) {
      setError(failText(e, "chatc.upload_failed"));
    } finally {
      setBusy(false);
      setProgress([]);
    }
  }

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (editing) return void saveEdit();
    void sendNow(body, files);
  }

  /** C3c.2: «ابعت بدون صوت» from the send button's menu: the same send, silent (never while an edit is saved, never with the company's switch off). */
  function submitSilent() {
    if (editing || detail.silentSend === false) return;
    void sendWith(body, files, clientId, true);
  }

  // ---------- C3c.3 «جدول الإرسال» ----------
  const scheduledUrl = `/api/chat/conversations/${encodeURIComponent(conversationId)}/scheduled`;
  // the list is read when the conversation opens (a 404 is the company's switch off, or no right to write: no icon, no menu entry); a person who only reads in silence never asks
  // C3w.2: the HEADER says whether the entry is on offer and how many rows wait (`header.scheduled`, absent: off or may not write); the list is read only when some wait,
  // or when the person opens the dialog or the list (the company's zone comes with it) — no request for every conversation that opens
  const plan = scheduledPlanOf({ scheduled: detail.scheduled, oversight: detail.me.oversight, meId });
  // the conversation the person is in NOW (an answer for the one they left is nobody's) and whether a list is here (read while rendering, like `live` elsewhere)
  const activeConversation = React.useRef(conversationId);
  activeConversation.current = conversationId;
  const listHere = React.useRef(false);
  listHere.current = scheduledList !== null;
  async function refreshScheduled(): Promise<ScheduledAnswer | null> {
    const asked = conversationId;
    try {
      const response = await fetch(scheduledUrl, { cache: "no-store" });
      const list = response.ok ? ((await response.json()) as ScheduledAnswer) : null;
      if (activeConversation.current !== asked) return null;
      setScheduledList(list);
      return list;
    } catch {
      // the network is gone: the icon keeps what it had and the next action asks again
      return null;
    }
  }
  React.useEffect(() => {
    listHere.current = false;
    setScheduledList(null);
    setScheduledOpen(false);
    setScheduleDialog(null);
  }, [conversationId, meId]);
  React.useEffect(() => {
    // read at the opening when the header says some wait, and read again when its number moves while a list is here (a row went out elsewhere): never otherwise
    if (!plan.loadOnOpen && !listHere.current) return;
    let live = true;
    void fetch(scheduledUrl, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as ScheduledAnswer) : null))
      .then((list) => {
        if (live) setScheduledList(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked again when the conversation, the person or the header's number changes
  }, [conversationId, plan.loadOnOpen, plan.count]);
  React.useEffect(() => {
    if (!scheduleNotice) return;
    const timer = setTimeout(() => setScheduleNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [scheduleNotice]);
  const failureOf = async (response: Response, fallbackKey: string): Promise<string> => {
    const key = errorKeyOf(await response.json().catch(() => null));
    return ct(key ?? fallbackKey);
  };

  /** «جدول الإرسال» from the send button's menu: asks WHEN (the dialog), then `scheduleNow`. Never while an edit is saved or with nothing to send. */
  async function openScheduleDialog() {
    if (editing || !plan.entry || (!body.trim() && !files.length)) return;
    setError("");
    // the company's zone is in the list: read it now when the header's number did not make us read it at the opening
    const list = scheduledList ?? (await refreshScheduled());
    if (activeConversation.current !== conversationId) return;
    if (!list || list.canSchedule !== true) return void setError(ct("chat.sched.e.action_failed"));
    setScheduleDialog({ edit: null });
  }
  /** The calendar icon opens the list; it is read first when nothing was read yet. */
  function showScheduled(open: boolean) {
    setScheduledOpen(open);
    if (open && !scheduledList) void refreshScheduled();
  }
  /** The dialog's «جدول»: the files go up, then ONE row is made with the words, the mentions and the moment. The box is emptied like after a send; a failure comes back as a sentence for the dialog. */
  async function scheduleNow(input: ScheduleSubmit): Promise<string | null> {
    // a send or an upload is running: say so (a null would close the dialog as if it had worked)
    if (busy) return ct("chat.sched.e.busy");
    if (!body.trim() && !files.length) return ct("chat.e.empty");
    const tray = files;
    setBusy(true);
    setError("");
    setProgress(tray.map(() => 0));
    try {
      const kept = scheduleUploads.current;
      const reuse = kept !== null && kept.files.length === tray.length && kept.files.every((file, i) => file === tray[i]?.file);
      const attachmentIds = reuse ? kept.ids : await uploadTray(tray);
      scheduleUploads.current = tray.length > 0 ? { files: tray.map((item) => item.file), ids: attachmentIds } : null;
      const response = await fetch(scheduledUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: body.trim(), attachmentIds, mentions: selectedMentionIds(body, mentions),
          ...(canAll && mentionsAll(body) ? { mentionAll: true } : {}),
          ...(reply ? { replyToId: reply.id } : {}),
          ...(noPreview === true ? { noPreview: true } : {}),
          sendAt: input.sendAt, clientId: scheduleKey.current,
        }),
      });
      if (!response.ok) return await failureOf(response, "chat.sched.e.save_failed");
      for (const f of tray) if (f.preview) URL.revokeObjectURL(f.preview);
      if (draftOn) clearComposerDraft(meId, conversationId);
      setBody("");
      setFiles([]);
      setMentions([]);
      setClientId(messageClientId());
      scheduleKey.current = messageClientId();
      scheduleUploads.current = null;
      onCancelReply();
      setScheduleDialog(null);
      setScheduleNotice(ct("chatsched.done"));
      await refreshScheduled();
      return null;
    } catch (e) {
      return failText(e, "chat.sched.e.save_failed");
    } finally {
      setBusy(false);
      setProgress([]);
    }
  }
  /** «عدّل» from the list: the dialog opens on that row (its words and its moment). */
  function beginEditScheduled(item: ScheduledItem) {
    setScheduledError("");
    setScheduledOpen(false);
    setScheduleDialog({ edit: item });
  }
  async function saveScheduledEdit(item: ScheduledItem, input: ScheduleSubmit): Promise<string | null> {
    try {
      const response = await fetch(`/api/chat/scheduled/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // the moment is sent only when the person changed it: a row that is a few seconds from going out can still have its words edited
        body: JSON.stringify({ ...(editChangesTime(item.sendAt, input.sendAt) ? { sendAt: input.sendAt } : {}), ...(input.body !== undefined ? { body: input.body } : {}) }),
      });
      if (!response.ok) return await failureOf(response, "chat.sched.e.save_failed");
      setScheduleDialog(null);
      await refreshScheduled();
      setScheduledOpen(true);
      return null;
    } catch (e) {
      return failText(e, "chat.sched.e.save_failed");
    }
  }
  /** One action of the list («ابعت هلّق» or «احذف») on one row; the list is read again afterwards whatever happened. */
  async function actOnScheduled(id: string, run: () => Promise<Response>, then?: (response: Response) => Promise<void>) {
    if (scheduledBusy) return;
    setScheduledBusy(id);
    setScheduledError("");
    try {
      const response = await run();
      if (!response.ok) setScheduledError(await failureOf(response, "chat.sched.e.action_failed"));
      else if (then) await then(response);
    } catch {
      setScheduledError(ct("chat.sched.e.action_failed"));
    } finally {
      setScheduledBusy(null);
      await refreshScheduled();
    }
  }
  function sendScheduledNow(id: string) {
    void actOnScheduled(id, () => fetch(`/api/chat/scheduled/${encodeURIComponent(id)}/send`, { method: "POST" }), async (response) => {
      const answer = (await response.json().catch(() => null)) as { message?: MessageDto | null } | null;
      // the job may have sent it a moment before (the answer then carries no message): nothing was sent by THIS action, so no sound
      if (answer?.message) {
        onMessage(answer.message);
        playChatSound("sent");
      }
    });
  }
  function deleteScheduled(id: string) {
    void actOnScheduled(id, () => fetch(`/api/chat/scheduled/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }

  /** The paste dialog's «ابعت»: the pictures go with the caption, as pictures or (the toggle) as files. */
  function sendPasted(caption: string, asFile: boolean) {
    if (!pasted || busy) return;
    const added = pasted.map((file) => {
      const kind = classifyFile(file);
      return { file, kind, asFile, preview: kind === "IMAGE" ? URL.createObjectURL(file) : null } satisfies PendingFile;
    });
    // what is already in the tray goes with the pictures; the id is renewed (what is sent changed) and THIS send uses it
    const tray = [...filesRef.current, ...added];
    const id = messageClientId();
    setPasted(null);
    setClientId(id);
    setBody(caption);
    keepDraft(caption, mentions);
    setFiles(tray);
    void sendNow(caption, tray, id);
  }

  // ---------- voice ----------
  // «نص مباشر أثناء التسجيل» (the switch `voiceLiveText`): the browser's recognition writes the words while the take is recorded; none of it exists with the switch off
  const liveTextOn = detail.voiceLiveText === true;
  const dictation = React.useMemo(() => (liveTextOn && typeof window !== "undefined" ? createDictation(browserRecognition()) : null), [liveTextOn]);
  const live = React.useSyncExternalStore(dictation?.subscribe ?? NO_SUBSCRIBE, dictation?.getSnapshot ?? (() => NO_LIVE), dictation?.getServerSnapshot ?? (() => NO_LIVE));
  async function startRecording(hold: boolean) {
    if (voice.mode !== "idle" || busy || editing) return;
    setError("");
    const rec = new VoiceRecorder({
      onTick: (elapsedMs) => setVoice((v) => (v.mode === "recording" ? { ...v, elapsedMs } : v)),
      onPeaks: (peaks) => setVoice((v) => (v.mode === "recording" ? { ...v, peaks } : v)),
      // the 5-minute cap or a hidden page: the take waits to be sent or thrown away, it is never lost
      onAutoStop: (take) => {
        dictation?.cancel();
        recorder.current = null;
        releaseHold.current?.();
        setVoice(take ? { mode: "review", take } : { mode: "idle" });
      },
    });
    recorder.current = rec;
    setVoice({ mode: "recording", elapsedMs: 0, peaks: [], hold, locked: false });
    try {
      await rec.start();
      // the finger lifted (or slid away) while the browser was still asking for the microphone
      if (recorder.current !== rec) rec.cancel();
      else dictation?.start();
    } catch (e) {
      dictation?.cancel();
      recorder.current = null;
      releaseHold.current?.();
      setVoice({ mode: "idle" });
      const key = e instanceof Error ? e.name : "";
      setError(key.startsWith("mic.") ? ct(`chat.f.${key}`) : ct("chat.f.mic.unavailable"));
    }
  }
  function cancelRecording() {
    dictation?.cancel();
    releaseHold.current?.();
    recorder.current?.cancel();
    recorder.current = null;
    setVoice({ mode: "idle" });
  }
  /** «ابعت كنص»: the words heard so far go as a text message; the recording is thrown away */
  async function sendVoiceAsText() {
    const text = dictation?.finish() ?? "";
    recorder.current?.cancel();
    recorder.current = null;
    releaseHold.current?.();
    setVoice({ mode: "idle" });
    if (!text.trim()) {
      setError(ct("chatlive.empty"));
      return;
    }
    await sendNow(text.trim(), [], messageClientId());
  }
  async function sendVoice(take?: VoiceTake | null) {
    dictation?.cancel();
    let recording = take ?? null;
    if (!recording && recorder.current) {
      recording = await recorder.current.stop();
      recorder.current = null;
    }
    releaseHold.current?.();
    setVoice({ mode: "idle" });
    if (!recording || recording.durationMs < 500) return; // a slip of the finger, not a message
    setBusy(true);
    setError("");
    setProgress([0]);
    try {
      const result = await uploadWithProgress("/api/chat/uploads", createVoiceUploadFormData(recording), (percent) => setProgress([percent]));
      if (typeof result["id"] !== "string") throw new Error(ct("chat.f.upload_failed"));
      await postMessage({ body: "", attachmentIds: [result["id"]], mentions: [], ...(reply ? { replyToId: reply.id } : {}), clientId: messageClientId(), voice: true }, false);
      onCancelReply();
    } catch (e) {
      setError(failText(e, "chat.f.upload_failed"));
    } finally {
      setBusy(false);
      setProgress([]);
    }
  }
  // Esc throws a recording away (the text box is not on screen while recording)
  const recordingNow = voice.mode !== "idle";
  React.useEffect(() => {
    if (!recordingNow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelRecording only touches refs and a setter
  }, [recordingNow]);

  // On a phone: press and hold to record, lift to send, slide sideways to cancel, slide up to lock. The recording bar replaces the mic as soon as the hold
  // starts, so the finger is followed on the window. With a mouse (or a keyboard) a click starts and a click on the bar's button stops.
  const lastTouchAt = React.useRef(0);
  function onMicPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse") return;
    // a second finger never starts a second recorder
    if (releaseHold.current) return;
    lastTouchAt.current = Date.now();
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      releaseHold.current = null;
      lastTouchAt.current = Date.now();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const outcome = holdOutcome(start, { x: e.clientX, y: e.clientY });
      if (outcome === "cancel") { done(); cancelRecording(); }
      else if (outcome === "lock") {
        // the finger is free: the bar keeps going with its own cancel and send
        done();
        setVoice((v) => (v.mode === "recording" ? { ...v, hold: false, locked: true } : v));
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      done();
      void sendVoice();
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      done();
      cancelRecording();
    };
    releaseHold.current = done;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    void startRecording(true);
  }
  function onMicClick() {
    // a tap on a phone also fires `click` just after the hold: the hold already handled it (a click from the keyboard, much later, is a start)
    if (Date.now() - lastTouchAt.current < 800) return;
    void startRecording(false);
  }

  // ---------- the box ----------
  function onTextChange(text: string) {
    // a finished «/» command opens the menu and leaves the box empty (what was typed is the command, not a message)
    const command = !editing && detail.me.canRecall ? slashCommand(text, detail.me.recallKinds) : null;
    if (command) { setRecall(command); setBody(""); keepDraft("", mentions); return; }
    // «/آراء حراك»: the same for the feedback picker, where the person may use the product sheets at all
    const feedbackAsk = !editing && detail.me.canRecall && detail.me.recallKinds?.includes("product") ? feedbackCommand(text) : null;
    if (feedbackAsk) { setFeedback(feedbackAsk); setBody(""); keepDraft("", mentions); return; }
    setClientId(messageClientId());
    setBody(text);
    keepDraft(text, mentions);
    // C3a.3: nobody types to anybody in the saved chat
    if (!editing && text.trim() && !isSavedHeader(detail)) notifyTyping();
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing;
    // while the list of people is open the keys drive IT: arrows move, Enter or Tab picks, Escape closes it
    if (choices.length > 0 && !composing) {
      if (event.key === "ArrowDown") { event.preventDefault(); setPick((pickAt + 1) % choices.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setPick((pickAt - 1 + choices.length) % choices.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); const chosen = choices[pickAt]; if (chosen) selectMention(chosen.id, chosen.name); return; }
      if (event.key === "Escape") { event.preventDefault(); setDismissed(body); return; }
    }
    // Esc cancels the edit, or the reply
    if (event.key === "Escape" && !composing) {
      if (editing) { event.preventDefault(); onCancelEdit(); return; }
      if (reply) { event.preventDefault(); onCancelReply(); return; }
    }
    // «↑» in an EMPTY box edits my last text message
    if (arrowUpEdits({ key: event.key, text: body, fileCount: files.length, composing, choicesOpen: choices.length > 0, editing: editing !== null, recording: voice.mode !== "idle", shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey }) && editLast) {
      event.preventDefault();
      editLast();
      return;
    }
    // Enter sends, Shift+Enter is a new line; never while an input method is composing a word. C4.1's «مفتاح الإرسال»: with «كنترول مع إنتر» only Ctrl+Enter sends
    // and a plain Enter is a new line (the choice is read from this device's copy of the person's settings, at the moment of the key)
    if (enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: composing }) && sendKeyAllows(readDevicePrefs().mirror?.sendKey, event)) {
      event.preventDefault();
      if (canSubmitNow({ text: body, fileCount: files.length, editing: editing !== null, voiceOn, busy })) event.currentTarget.form?.requestSubmit();
    }
  }
  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (editing) return;
    const images = pastedImages(event.clipboardData);
    if (images.length) {
      event.preventDefault();
      setPasted(images);
      return;
    }
    // a PDF copied in the file manager: a plain file in the tray; words are the browser's own paste
    const documents = pastedDocuments(event.clipboardData);
    if (documents.length) {
      event.preventDefault();
      addFiles(forDropMode(documents, "files"));
    }
  }

  const voiceOn = detail.voiceNotes !== false;
  const face = composerFaceOf({ text: body, fileCount: files.length, editing: editing !== null, voiceOn });
  return {
    body, files, busy, error, progress, voice, voiceOn, face,
    canSubmit: canSubmitNow({ text: body, fileCount: files.length, editing: editing !== null, voiceOn, busy }),
    choices, pickAt, setPick,
    hint: composerHintOf(body, detail, editing !== null),
    pollOpen, setPollOpen, recall, setRecall, feedback, setFeedback, pasted, setPasted, noPreview, setNoPreview,
    textRef, mediaInput, fileInput,
    // «بوت فاذر»'s «/» menu and «ابدأ»: these words go as a message of their own, and the box is emptied of what was typed to find them
    sendText: (text: string) => {
      if (busy) return;
      setBody("");
      keepDraft("", []);
      void sendNow(text, [], messageClientId());
    },
    addFiles, addDropped: (list: ArrayLike<File>, asFile: boolean) => addFiles(forDropMode(list, asFile ? "files" : "media")), removeFile, replaceFile, setHd, selectMention, insertAtCaret,
    onTextChange, onKeyDown, onPaste, submit, submitSilent, silentSendOn: detail.silentSend !== false, sendPasted,
    // C3c.3: the send menu's «جدول الإرسال» (only where the person may write and the company's switch is on), the dialogs and the list
    scheduling: !editing && plan.entry && scheduledList?.canSchedule !== false, scheduledCount: scheduledList ? scheduledList.items.length : plan.count, scheduledItems: scheduledList?.items ?? [], scheduledZone: scheduledList?.timeZone ?? "UTC",
    scheduleDialog, closeScheduleDialog: () => setScheduleDialog(null), openScheduleDialog, scheduleNow, saveScheduledEdit,
    scheduledOpen, setScheduledOpen: showScheduled, scheduledBusy, scheduledError, scheduleNotice, beginEditScheduled, sendScheduledNow, deleteScheduled,
    startRecording, cancelRecording, sendVoice, onMicPointerDown, onMicClick,
    // «نص مباشر أثناء التسجيل»: what the recorder bar shows above the pill (absent while the switch is off)
    live: dictation ? { supported: live.supported, listening: live.listening, text: dictationText(live.final, live.interim), lang: live.lang, error: live.error, setLang: dictation.setLang, sendAsText: sendVoiceAsText } : undefined,
    insertWords: (text: string) => { const next = body ? `${body} ${text}` : text; setClientId(messageClientId()); setBody(next); keepDraft(next, mentions); textRef.current?.focus(); },
    setDismissed,
  };
}

const NO_SUBSCRIBE = () => () => undefined;
const NO_LIVE: DictationSnapshot = { supported: false, listening: false, final: "", interim: "", lang: DEFAULT_DICTATION_LANG, error: null };

export type ComposerEngine = ReturnType<typeof useComposer>;
