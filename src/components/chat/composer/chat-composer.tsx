"use client";
import React from "react";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";
import { useI18n } from "@/lib/i18n";
import { classifyFile, exceedsKindLimit, MAX_ATTACHMENTS_PER_MESSAGE, type FileKind } from "@/lib/chat/file-kinds";
import { compressImage } from "@/lib/chat/compress-image";
import { createChatUploadFormData, createVoiceUploadFormData, enterSends, messageClientId } from "@/lib/chat/conversation/client";
import { ASSISTANT_MENTION_ID, filterMentionChoices, findMentionQuery, insertMention, MENTION_ALL_NAME, mentionsAll, selectedMentionIds } from "@/lib/chat/conversation/mentions";
import { Avatar } from "@/components/ui/avatar";
import { useTyping } from "@/lib/realtime/use-realtime";
import { playChatSound } from "@/lib/chat/sounds";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { VoiceRecorder, type VoiceTake } from "@/lib/chat/voice-recorder";
import { barsFor, formatDuration } from "@/lib/chat/waveform";
import { PollDialog } from "@/components/chat/composer/poll-dialog";
import type { Outbox } from "@/lib/chat/outbox/queue";
import { postChatMessage, SEND_TIMEOUT_MS, type ChatSendPayload } from "@/lib/chat/outbox/send";
import { clearComposerDraft, loadComposerDraft, saveComposerDraft } from "@/lib/chat/composer-draft";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type PendingFile = { file: File; kind: FileKind; preview: string | null };
/** idle: the text row; recording: the mic is open; review: a take that stopped by itself waits for send or cancel. */
type VoiceState = { mode: "idle" } | { mode: "recording"; elapsedMs: number; peaks: number[]; hold: boolean } | { mode: "review"; take: VoiceTake };

/** The words (and the people mentioned) of a message that failed for good, put back in the box by «عدّل». */
export interface OutboxRestore { id: string; body: string; mentions: string[] }

/** A finger that slides this far from the mic while holding throws the take away. */
export const HOLD_CANCEL_PX = 80;

const iconButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full";

/**
 * `editing`: «تعديل» from the message menu edits IN this box (there is no second edit box): the text is
 * loaded here, «+» and the microphone step aside, and sending saves the edit.
 */
export function ChatComposer({ conversationId, detail, onMessage, reply, onCancelReply, editing = null, onCancelEdit, onEdited, outbox = null, restore = null, onRestored }: { conversationId: string; detail: ConversationDto; onMessage: (message: MessageDto) => void; reply: MessageDto | null; onCancelReply: () => void; editing?: MessageDto | null; onCancelEdit?: () => void; onEdited?: (message: MessageDto) => void;
  /** the person's outbox («الرسائل بدون نت»): a text that cannot be sent is kept there instead of failing; null: the switch is off, a failure shows an error as before */
  outbox?: Outbox | null; restore?: OutboxRestore | null; onRestored?: () => void }) {
 const { t } = useI18n(); const { notifyTyping } = useTyping(conversationId); const [body,setBody]=React.useState(""); const [files,setFiles]=React.useState<PendingFile[]>([]); const [mentions,setMentions]=React.useState<Array<{id:string;name:string}>>([]); const [busy,setBusy]=React.useState(false); const [error,setError]=React.useState("");
 const [progress, setProgress] = React.useState<number[]>([]);
 const [voice, setVoice] = React.useState<VoiceState>({ mode: "idle" });
 const recorder = React.useRef<VoiceRecorder | null>(null);
 const holdStart = React.useRef<{ x: number; y: number } | null>(null);
 const mediaInput = React.useRef<HTMLInputElement | null>(null);
 const fileInput = React.useRef<HTMLInputElement | null>(null);
 const [clientId, setClientId] = React.useState(() => messageClientId());
 const [pollOpen, setPollOpen] = React.useState(false);
 // who «@» offers: everybody the conversation reaches (an open topic: its whole space), never myself; «@الكل» first where I may use it
 const memberOptions=(detail.mentionables??detail.members??[]).filter(m=>m.id!==detail.me.id); const activeMention=findMentionQuery(body); const query=activeMention?.query??"";
 const canAll=Boolean(detail.me.canMentionAll);
 const [pick,setPick]=React.useState(0); const [dismissed,setDismissed]=React.useState<string|null>(null);
 const people=activeMention&&dismissed!==body?filterMentionChoices(memberOptions,query):[];
 const offerAll=Boolean(activeMention)&&dismissed!==body&&canAll&&filterMentionChoices([{name:MENTION_ALL_NAME}],query).length>0;
 const choices:Array<{id:string;name:string;online?:boolean;avatarUrl?:string|null;all?:boolean}>=[...(offerAll?[{id:"*",name:MENTION_ALL_NAME,all:true}]:[]),...people];
 const pickAt=Math.min(pick,Math.max(0,choices.length-1));
 React.useEffect(()=>{setPick(0);},[query]);

 // previews are object URLs: give them back when the file leaves the list, and when the screen goes
 const filesRef = React.useRef(files);
 filesRef.current = files;
 React.useEffect(() => () => {
  for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
  recorder.current?.cancel(); // never leave the microphone on behind a closed conversation
 }, []);

 // the unsent words of this conversation survive a navigation, a reload and a closed tab («الرسائل بدون نت»); the switch off: no draft is kept
 const meId = detail.me.id ?? "";
 const draftOn = detail.chatOutbox !== false && !detail.me.oversight && meId !== "";
 const textRef = React.useRef<HTMLTextAreaElement | null>(null);
 const membersRef = React.useRef(memberOptions);
 membersRef.current = memberOptions;
 function keepDraft(nextBody: string, nextMentions: Array<{ id: string; name: string }>) {
  if (draftOn && !editing) saveComposerDraft(meId, conversationId, { body: nextBody, mentions: nextMentions.map(m => m.id) });
 }
 // an edit starts with the message's own words in the box; without one the box starts with this conversation's draft (or empty)
 React.useEffect(() => {
  if (editing) {
   setBody(editing.body ?? "");
  } else {
   const draft = draftOn ? loadComposerDraft(meId, conversationId) : null;
   setBody(draft ? draft.body : "");
   if (draft) setMentions(draft.mentions.flatMap(id => { const m = membersRef.current.find(x => x.id === id); return m ? [{ id: m.id, name: m.name }] : []; }));
  }
  setError("");
 }, [editing, conversationId, meId, draftOn]);
 // «عدّل» on a message that failed for good: its words come back to the box (after what is already typed there)
 React.useEffect(() => {
  if (!restore) return;
  const next = body.trim() ? `${body}\n${restore.body}` : restore.body;
  const restored = restore.mentions.flatMap(id => { const m = membersRef.current.find(x => x.id === id); return m ? [{ id: m.id, name: m.name }] : []; });
  const nextMentions = [...mentions, ...restored.filter(r => !mentions.some(m => m.id === r.id))];
  setClientId(messageClientId());
  setBody(next);
  setMentions(nextMentions);
  keepDraft(next, nextMentions);
  textRef.current?.focus();
  onRestored?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per restored message
 }, [restore]);

 function addFiles(list: FileList | null) {
  if (!list) return;
  const incoming = Array.from(list).map(file => {
   const kind = classifyFile(file);
   return { file, kind, preview: kind === "IMAGE" || kind === "VIDEO" ? URL.createObjectURL(file) : null };
  });
  if (incoming.length) setClientId(messageClientId());
  setFiles(current => [...current, ...incoming]);
 }
 function removeFile(index: number) {
  setClientId(messageClientId());
  setFiles(current => {
   const gone = current[index];
   if (gone?.preview) URL.revokeObjectURL(gone.preview);
   return current.filter((_, i) => i !== index);
  });
 }
 function selectMention(id: string, name: string) {
  setClientId(messageClientId());
  const nextBody = insertMention(body, name);
  setBody(nextBody);
  if (id === "*" || id === ASSISTANT_MENTION_ID) { keepDraft(nextBody, mentions); return; } // «@الكل» and «@المساعد» are read from the words of the message at send time, they are no person
  const nextMentions = mentions.some(member => member.id === id) ? mentions : [...mentions, { id, name }];
  setMentions(nextMentions);
  keepDraft(nextBody, nextMentions);
 }
 const failText = (e: unknown, fallback: string) => {
  const key = e instanceof Error ? e.message : "";
  return key.startsWith("chat.") ? t(key) : key || t(fallback);
 };

 /** Keep a message in the outbox (the pending bubble appears from there). A full outbox is a clear error and the text stays in the box. */
 function keep(queue: Outbox, payload: ChatSendPayload, retryAfterSec?: number) {
  const result = queue.enqueue({
   clientId: payload.clientId, conversationId, body: payload.body.trim(), mentions: payload.mentions,
   ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
   ...(payload.attachmentIds.length ? { attachmentIds: payload.attachmentIds } : {}),
   ...(payload.mentionAll ? { mentionAll: true } : {}),
  }, Date.now(), retryAfterSec !== undefined ? { retryAfterSec } : {});
  if (!result.ok) throw new Error(t("outbox.full"));
 }

 /**
  * Send one message. Through the outbox (a text, or a text with files already uploaded) when the network is gone or
  * answers 502/503/504, or when this conversation already has messages waiting (they leave first: the order is kept);
  * a voice note is never queued (`queueable` false): it keeps the error, as before.
  */
 async function postMessage(payload: ChatSendPayload, queueable = true) {
  const queue = queueable ? outbox : null;
  if (queue) {
   const waiting = queue.forConversation(conversationId).some(i => !i.failed);
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
  throw new Error(outcome.kind === "refused" ? t(outcome.failure.key) : t("chatc.message_failed"));
 }

 async function saveEdit() {
  if (!editing || !body.trim()) return;
  setBusy(true);
  setError("");
  try {
   const response = await fetch(`/api/chat/messages/${encodeURIComponent(editing.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: body.trim() }),
   });
   if (!response.ok) throw new Error(t("chatc.message_failed"));
   onEdited?.(await response.json() as MessageDto);
  } catch (e) {
   setError(failText(e, "chatc.message_failed"));
  } finally {
   setBusy(false);
  }
 }

 async function submit(event: React.FormEvent) {
  event.preventDefault();
  if (editing) return void saveEdit();
  if (busy || (!body.trim() && !files.length)) return;
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
   setError(t("chatc.too_many_files"));
   return;
  }
  setBusy(true);
  setError("");
  setProgress(files.map(() => 0));
  try {
   const attachmentIds: string[] = [];
   for (const [index, item] of files.entries()) {
    let upload = item.file;
    if (item.kind === "IMAGE") {
     const compressed = await compressImage(item.file, item.file.name);
     if (compressed) upload = new File([compressed.blob], item.file.name, { type: compressed.mime });
    }
    if (exceedsKindLimit(upload.size, item.kind)) throw new Error(t("chatc.file_too_large"));
    const result = await uploadWithProgress("/api/chat/uploads", createChatUploadFormData(upload, item.kind), percent =>
     setProgress(current => current.map((p, i) => (i === index ? percent : p))),
    );
    if (typeof result["id"] !== "string") throw new Error(t("chatc.upload_failed"));
    attachmentIds.push(result["id"]);
   }
   await postMessage({ body: body.trim(), attachmentIds, mentions: selectedMentionIds(body, mentions), ...(canAll && mentionsAll(body) ? { mentionAll: true } : {}), ...(reply ? { replyToId: reply.id } : {}), clientId });
   for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
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

 // ---------- voice ----------
 async function startRecording(hold: boolean) {
  if (voice.mode !== "idle" || busy) return;
  setError("");
  const rec = new VoiceRecorder({
   onTick: elapsedMs => setVoice(v => (v.mode === "recording" ? { ...v, elapsedMs } : v)),
   onPeaks: peaks => setVoice(v => (v.mode === "recording" ? { ...v, peaks } : v)),
   // the 5-minute cap or a hidden page: the take waits to be sent or thrown away, it is never lost
   onAutoStop: take => { recorder.current = null; setVoice(take ? { mode: "review", take } : { mode: "idle" }); },
  });
  recorder.current = rec;
  setVoice({ mode: "recording", elapsedMs: 0, peaks: [], hold });
  try {
   await rec.start();
   // the finger lifted (or slid away) while the browser was still asking for the microphone
   if (recorder.current !== rec) rec.cancel();
  } catch (e) {
   recorder.current = null;
   setVoice({ mode: "idle" });
   const key = e instanceof Error ? e.name : "";
   setError(key.startsWith("mic.") ? t(`chat.f.${key}`) : t("chat.f.mic.unavailable"));
  }
 }
 function cancelRecording() {
  recorder.current?.cancel();
  recorder.current = null;
  holdStart.current = null;
  setVoice({ mode: "idle" });
 }
 async function sendVoice(take?: VoiceTake | null) {
  let recording = take ?? null;
  if (!recording && recorder.current) {
   recording = await recorder.current.stop();
   recorder.current = null;
  }
  holdStart.current = null;
  setVoice({ mode: "idle" });
  if (!recording || recording.durationMs < 500) return; // a slip of the finger, not a message
  setBusy(true);
  setError("");
  setProgress([0]);
  try {
   const result = await uploadWithProgress("/api/chat/uploads", createVoiceUploadFormData(recording), percent => setProgress([percent]));
   if (typeof result["id"] !== "string") throw new Error(t("chat.f.upload_failed"));
   await postMessage({ body: "", attachmentIds: [result["id"]], mentions: [], ...(reply ? { replyToId: reply.id } : {}), clientId: messageClientId(), voice: true }, false);
   onCancelReply();
  } catch (e) {
   setError(failText(e, "chat.f.upload_failed"));
  } finally {
   setBusy(false);
   setProgress([]);
  }
 }
 // On a phone: press and hold to record, lift to send, slide away to cancel. The recording bar replaces
 // the mic as soon as the hold starts, so the finger is followed on the window, not on the button.
 // With a mouse (or a keyboard) a click opens the bar, with its own cancel and send.
 const lastPointer = React.useRef<string>("mouse");
 function onMicPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
  lastPointer.current = event.pointerType;
  if (event.pointerType === "mouse") return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY };
  holdStart.current = start;
  const done = () => {
   window.removeEventListener("pointermove", move);
   window.removeEventListener("pointerup", up);
   window.removeEventListener("pointercancel", cancel);
  };
  const move = (e: PointerEvent) => {
   if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_CANCEL_PX) { done(); cancelRecording(); }
  };
  const up = () => { done(); void sendVoice(); };
  const cancel = () => { done(); cancelRecording(); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  void startRecording(true);
 }
 function onMicClick() {
  // a tap on a phone also fires `click` after the hold: the hold already handled it
  if (lastPointer.current !== "mouse") { lastPointer.current = "mouse"; return; }
  void startRecording(false);
 }

 const empty = !body.trim() && !files.length && !editing;
 // «الرسائل الصوتية» switch (`voiceNotes`): off, no microphone button and no «رسالة صوتية» in the «+» menu; absent: on
 const voiceOn = detail.voiceNotes !== false;
 const recording = voice.mode === "recording" ? voice : null;

 if (recording || voice.mode === "review") {
  const elapsed = recording ? recording.elapsedMs : voice.mode === "review" ? voice.take.durationMs : 0;
  const peaks = recording ? recording.peaks : voice.mode === "review" ? voice.take.peaks : [];
  return (
   <div className="flex flex-col gap-2" data-recording={voice.mode}>
    <div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 p-1">
     <button type="button" className={`${iconButton} text-danger`} aria-label={t("chat.f.cancel_recording")} onClick={cancelRecording}>
      <span aria-hidden="true">✕</span>
     </button>
     <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full bg-danger ${recording ? "motion-safe:animate-pulse" : "opacity-40"}`} />
     <span role="timer" aria-live="off" className="w-12 shrink-0 text-sm tabular-nums" dir="ltr">{formatDuration(elapsed)}</span>
     <div aria-hidden="true" className="flex h-8 flex-1 items-center gap-px overflow-hidden" dir="ltr">
      {barsFor(peaks, 32).map((p, i) => <span key={i} className="w-1 rounded-full bg-accent" style={{ height: `${Math.max(12, p)}%` }} />)}
     </div>
     <button
      type="button"
      className={`${iconButton} bg-accent text-accent-fg`}
      aria-label={t("chat.f.send_recording")}
      onClick={() => void sendVoice(voice.mode === "review" ? voice.take : null)}
     >
      <span aria-hidden="true">➤</span>
     </button>
    </div>
    <p className="text-center text-xs text-fg-muted" aria-live="polite">{recording?.hold ? t("chat.f.recording_hint") : recording ? t("chat.f.recording") : t("chat.f.voice_label")}</p>
    {error && <p role="alert">{error}</p>}
   </div>
  );
 }

 return (
  <form onSubmit={submit} className="flex flex-col gap-2">
   {editing && (
    <div className="flex items-center justify-between gap-2 rounded-md border-s-4 border-accent bg-surface-1 px-3 py-1 text-sm">
     <span>{t("chatc.editing")}</span>
     <button type="button" className="min-h-11 px-2" onClick={() => onCancelEdit?.()}>{t("chatc.cancel")}</button>
    </div>
   )}
   {files.length > 0 && (
    <ul className="flex flex-wrap gap-2" aria-label={t("chatc.attach")}>
     {files.map((item, index) => (
      <li key={`${item.file.name}-${index}`} className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-1 text-xs">
       {item.kind === "IMAGE" && item.preview
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing for next/image to optimise
        ? <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" />
        : item.kind === "VIDEO" && item.preview
         ? <video src={item.preview} muted preload="metadata" className="h-full w-full object-cover" aria-label={item.file.name} />
         : <span className="line-clamp-3 break-all p-1 text-center">{item.file.name}</span>}
       {!busy && (
        <button
         type="button"
         className="absolute end-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-fg shadow"
         aria-label={t("chat.f.remove", { name: item.file.name })}
         onClick={() => removeFile(index)}
        >
         <span aria-hidden="true">×</span>
        </button>
       )}
       {busy && progress[index] !== undefined && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress[index]} aria-label={t("chat.f.progress", { name: item.file.name, percent: progress[index] ?? 0 })}>
         <span className="block h-full bg-accent" style={{ width: `${progress[index]}%` }} />
        </span>
       )}
      </li>
     ))}
    </ul>
   )}
   {choices.length > 0 && (
    <ul id="chat-mention-list" role="listbox" aria-label={t("chatc.mention")} className="max-h-56 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
     {choices.map((member, index) => (
      <li key={member.id} id={`chat-mention-${index}`} role="option" aria-selected={index === pickAt}>
       <button
        type="button"
        className={`flex min-h-11 w-full items-center gap-2 px-3 text-start ${index === pickAt ? "bg-accent/10" : ""}`}
        onMouseEnter={() => setPick(index)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => selectMention(member.id, member.name)}
       >
        {member.id === ASSISTANT_MENTION_ID
         ? <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-info/15 text-sm font-bold text-info">✦</span>
         : member.all
         ? <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">@</span>
         : <span className="relative shrink-0"><Avatar name={member.name} src={member.avatarUrl} className="size-8 text-xs" />{member.online && <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-surface bg-ok" />}</span>}
        <span className="min-w-0 flex-1 truncate">{member.all ? `@${member.name}` : member.name}</span>
        {member.all && <span className="text-xs text-fg-muted">{t("chatc.mention_all_hint")}</span>}
        {member.id === ASSISTANT_MENTION_ID && <span className="text-xs text-fg-muted">{t("chatai.mention_hint")}</span>}
       </button>
      </li>
     ))}
    </ul>
   )}
   <div className="flex min-w-0 items-end gap-1.5 sm:gap-2">
    {!editing && <DropdownMenu>
     <DropdownMenuTrigger asChild>
      <button type="button" className={`${iconButton} border border-border text-xl`} aria-label={t("chat.f.attach_menu")} disabled={busy}>
       <span aria-hidden="true">+</span>
      </button>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => mediaInput.current?.click()}>{t("chat.f.attach_media")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => fileInput.current?.click()}>{t("chat.f.attach_file")}</DropdownMenuItem>
      {voiceOn && <DropdownMenuItem onSelect={() => void startRecording(false)}>{t("chat.f.voice_label")}</DropdownMenuItem>}
      {detail.me.canPoll && <DropdownMenuItem onSelect={() => setPollOpen(true)}>{t("chatc.poll.menu")}</DropdownMenuItem>}
     </DropdownMenuContent>
    </DropdownMenu>}
    <input ref={mediaInput} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <label className="sr-only" htmlFor="chat-message">{t("chatc.message")}</label>
    <textarea
     id="chat-message"
     ref={textRef}
     rows={1}
     value={body}
     onChange={event => { setClientId(messageClientId()); setBody(event.currentTarget.value); keepDraft(event.currentTarget.value, mentions); if (!editing && event.currentTarget.value.trim()) notifyTyping(); }}
     // Enter sends (the owner, 2026-10-26), Shift+Enter is a new line; never while an input method is composing a word
     onKeyDown={event => {
      // while the list of people is open the keys drive IT: arrows move, Enter or Tab picks, Escape closes it
      if (choices.length > 0 && !event.nativeEvent.isComposing) {
       if (event.key === "ArrowDown") { event.preventDefault(); setPick((pickAt + 1) % choices.length); return; }
       if (event.key === "ArrowUp") { event.preventDefault(); setPick((pickAt - 1 + choices.length) % choices.length); return; }
       if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); const chosen = choices[pickAt]; if (chosen) selectMention(chosen.id, chosen.name); return; }
       if (event.key === "Escape") { event.preventDefault(); setDismissed(body); return; }
      }
      if (enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) { event.preventDefault(); if (body.trim()) event.currentTarget.form?.requestSubmit(); } }}
     role="combobox" aria-expanded={choices.length > 0} aria-controls="chat-mention-list" aria-autocomplete="list" aria-activedescendant={choices.length > 0 ? `chat-mention-${pickAt}` : undefined}
     enterKeyHint="send"
     className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2 text-base"
     placeholder={t("chatc.message")}
    />
    {empty && voiceOn ? (
     <button
      type="button"
      className={`${iconButton} bg-accent text-accent-fg touch-none select-none`}
      aria-label={t("chat.f.record")}
      title={t("chat.f.hold_to_record")}
      disabled={busy}
      onClick={onMicClick}
      onPointerDown={onMicPointerDown}
     >
      <span aria-hidden="true">🎤</span>
     </button>
    ) : (
     <button type="submit" disabled={busy || (editing !== null && !body.trim()) || empty} className={`${iconButton} bg-accent text-accent-fg`} aria-label={editing ? t("chatc.save") : busy ? t("chatc.sending") : t("chatc.send")}>
      <span aria-hidden="true">{busy ? "…" : "➤"}</span>
     </button>
    )}
   </div>
   {busy && files.length === 0 && progress.length > 0 && <p className="text-xs text-fg-muted" role="status">{t("chat.f.uploading")}</p>}
   {error && <p role="alert">{error}</p>}
   {detail.me.canPoll && <PollDialog open={pollOpen} conversationId={conversationId} onClose={() => setPollOpen(false)} onCreated={message => { setPollOpen(false); onMessage(message); }} />}
  </form>
 );
}
