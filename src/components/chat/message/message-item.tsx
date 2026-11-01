import React from "react";
import type { MessageDto, ReaderDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtTime } from "@/lib/format";
import { systemSentence } from "@/lib/chat/system-sentence";
import { ct } from "@/lib/chat/text";
import { isMentioned, splitMentions } from "@/lib/chat/conversation/mentions";
import { PollCard } from "@/components/chat/message/poll-card";
import { AssistantLine } from "@/components/chat/message/assistant-line";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { MessageMenu, LONG_PRESS_MS } from "@/components/chat/message/message-menu";
import type { MessageMenuContext, MessageMenuId } from "@/components/chat/message/message-menu-registry";
/**
 * One message, laid out the way a modern messaging app lays it out (the owner, 2026-10-29: «نظام دردشة
 * نفس التطبيقات الحديثة»): the sender's picture and name sit OUTSIDE the bubble, the bubble itself is
 * narrow enough to read as a message and not as a paragraph, and the time is a quiet line in its corner.
 * My own messages keep the accent bubble and take no picture (it is me).
 *
 * `classic` is the company's «شكل الرسائل الحديث» switch read backwards (`src/lib/features.ts`): off, the
 * log is the shape it had before that day — one bubble for everybody with the name inside it, no picture
 * beside it. The words of a message (its reply, its body, its chips, its files, its reactions, its time)
 * are the same in both shapes, so nothing is lost by switching one way or the other.
 *
 * Its actions live in ONE menu (message-menu.tsx), never as buttons under the bubble: «⋯» beside it with
 * a mouse or the keyboard, a long press on a phone. What the menu offers comes from
 * message-menu-registry.ts, which mirrors the server's rules.
 */
export interface MessageItemProps { message: MessageDto; canModerate: boolean; oversight?: boolean; readers?: ReaderDto[]; conversationKind?: "DM" | "GROUP" | "TOPIC"; canPost?: boolean; canMakeWork?: boolean; canMakeTask?: boolean; canMakeTicket?: boolean; canRemind?: boolean; onReact: (message: MessageDto, emoji: string) => void; onAction: (message: MessageDto, id: MessageMenuId) => void;
  /** the names «@» can point at here (the people of the conversation and «الكل»): their mentions are drawn highlighted */
  mentionNames?: string[];
  /** me: a message that mentions me (by name or «@الكل») is marked for me */
  meId?: string;
  /** the company switched «شكل الرسائل الحديث» off: draw the older bubble */
  classic?: boolean;
  /** the first / last message of a run by one person (the name sits on the first, the picture and the tail on the last); absent: a lone message */
  groupStart?: boolean;
  groupEnd?: boolean;
  /** a «صارت مهمة/تذكرة» chip was tapped */
  onOpenWork?: (kind: "task" | "ticket", id: string) => void }
const safeMediaUrl = (url: string) => url.startsWith("/api/chat/attachments/") ? url : undefined;
const MAX_READER_AVATARS = 5;
/** DM ticks on my own message: ✓ sent, ✓✓ delivered (both muted), ✓✓ read in the info colour; the word is for screen readers. */
export function MessageTicks({status}:{status:NonNullable<MessageDto["status"]>}){const label=AR[`chatc.tick.${status}`]??"";return <span data-ticks={status} className={`inline-flex items-center text-xs ${status==="read"?"text-info":"text-fg-muted"}`}><span aria-hidden="true">{status==="sent"?"✓":"✓✓"}</span><span className="sr-only">{label}</span></span>;}
/** Who read, and when: every reader (no cap) with the time of their own read mark. */
export function ReaderList({readers}:{readers:ReaderDto[]}){return <ul data-reader-list aria-label={ct("chatc.readers_title")} className="mt-1 max-h-48 w-56 max-w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 text-sm shadow-lg">{readers.map(r=><li key={r.userId} className="flex items-center gap-2 px-2 py-1"><Avatar name={r.name} src={r.avatarUrl} className="size-6 text-xs"/><span className="min-w-0 flex-1 truncate">{r.name}</span>{r.readAt&&<time dateTime={r.readAt} dir="ltr" className="text-xs tabular-nums text-fg-muted">{fmtTime(r.readAt)}</time>}</li>)}</ul>;}
/** «فلان يكتب…» above the composer: nothing for nobody. */
export function TypingLine({names}:{names:string[]}){if(!names.length)return null;const text=names.length===1?ct("chatc.typing.one",{name:names[0]??""}):names.length===2?ct("chatc.typing.two",{a:names[0]??"",b:names[1]??""}):ct("chatc.typing.many",{names:names.join(ct("chatc.list_sep"))});return <p role="status" aria-live="polite" data-typing className="px-3 pb-1 text-xs text-fg-muted">{text}</p>;}
/** The small row of people whose newest read message is this one (topics and groups), five at most and «+n»; a tap opens who read and when. */
export function ReaderRow({readers}:{readers:ReaderDto[]}){const [open,setOpen]=React.useState(false);if(!readers.length)return null;const shown=readers.slice(0,MAX_READER_AVATARS);const more=readers.length-shown.length;const names=shown.map(r=>r.name).join(ct("chatc.list_sep"))+(more>0?` ${interpolate(AR["chatc.readers_more"]??"",{count:more})}`:"");return <div data-readers className="mt-1 flex flex-col items-end"><button type="button" aria-expanded={open} aria-label={interpolate(AR["chatc.readers"]??"",{names})} onClick={()=>setOpen(v=>!v)} className="flex min-h-6 justify-end gap-0.5">{shown.map(r=><Avatar key={r.userId} name={r.name} src={r.avatarUrl} className="h-6 w-6"/>)}{more>0&&<span aria-hidden="true" className="self-center text-xs text-fg-muted">+{more}</span>}</button>{open&&<ReaderList readers={readers}/>}</div>;}
export function MessageItem({message,canModerate,oversight=false,readers=[],conversationKind="TOPIC",canPost=true,canMakeWork=false,canMakeTask,canMakeTicket,canRemind=false,classic=false,mentionNames=[],meId,groupStart=true,groupEnd=true,onReact,onAction,onOpenWork}: MessageItemProps) {
 const [sheetOpen,setSheetOpen]=React.useState(false);
 const press=React.useRef<{timer:ReturnType<typeof setTimeout>;x:number;y:number}|null>(null);
 const canAct=!oversight&&!message.deleted&&message.kind!=="SYSTEM";
 // a system line is a quiet sentence in the middle, never a bubble with an empty body
 if(message.kind==="SYSTEM"&&message.system?.k==="assistant")return <AssistantLine meta={message.system} time={fmtTime(message.createdAt)} createdAt={message.createdAt}/>;
 if(message.kind==="SYSTEM")return <p dir="rtl" role="note" className="my-2 text-center text-xs text-fg-muted">{systemSentence(message.system,message.authorName)}</p>;
 const context:MessageMenuContext={mine:message.mine,deleted:message.deleted,kind:message.kind,hasText:Boolean(message.body&&message.body.trim()),pinned:message.pinned,conversationKind,canPost,canModerate,oversight,canMakeWork,canMakeTask,canMakeTicket,canRemind};
 // a phone's long press opens the menu sheet; moving the finger (a scroll) or lifting early is no press
 const endPress=()=>{if(press.current){clearTimeout(press.current.timer);press.current=null;}};
 const onPointerDown=(e:React.PointerEvent)=>{if(e.pointerType==="mouse"||!canAct)return;const {clientX:x,clientY:y}=e;press.current={x,y,timer:setTimeout(()=>{press.current=null;setSheetOpen(true);},LONG_PRESS_MS)};};
 const onPointerMove=(e:React.PointerEvent)=>{const p=press.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>10)endPress();};
 const time=fmtTime(message.createdAt);
 // the bubble: mine in the accent, the others' on the surface; the corner nearest its author stays tight
 const mentionsMe=!message.mine&&!message.deleted&&Boolean(meId)&&isMentioned(message.mentions,meId as string);
 const bubble=`max-w-[85%] min-w-0 break-words rounded-2xl border px-3 py-2 [@media(hover:none)]:select-none sm:max-w-[75%] ${message.mine?`border-accent/30 bg-accent/10 ${groupEnd?"rounded-ee-md":""}`:mentionsMe?`border-warn/50 bg-warn/10 ${groupEnd?"rounded-es-md":""}`:`border-border bg-surface ${groupEnd?"rounded-es-md":""}`}`;
 const run=groupStart&&groupEnd?"single":groupStart?"start":groupEnd?"end":"middle";
 const timeLine=<span className="mt-1 flex items-center justify-end gap-1.5 text-xs text-fg-muted">{message.edited&&<span>{ct("chatc.edited")}</span>}{message.pinned&&<span>{ct("chatc.pinned")}</span>}<time dateTime={message.createdAt} dir="ltr" className="tabular-nums">{time}</time>{message.mine&&message.status&&!message.deleted&&<MessageTicks status={message.status}/>}</span>;
 const menu=canAct?<MessageMenu context={context} onAction={id=>onAction(message,id)} onReact={emoji=>onReact(message,emoji)} sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen}/>:null;
 // what a message SAYS: the same in both shapes (only where it sits and what surrounds it differ)
 const content=<>
  {message.replyTo&&<blockquote className="mb-1.5 border-s-2 border-accent/40 bg-surface-2/60 px-2 py-1 text-xs"><span className="block font-semibold text-fg-muted">{message.replyTo.authorName}</span><span className="line-clamp-2">{message.replyTo.deleted?ct("chatc.deleted"):message.replyTo.preview??ct("chatc.message_fallback")}</span></blockquote>}
  {mentionsMe&&<span data-mentions-me className="mb-1 block text-xs font-semibold text-warn">{ct("chatc.mention_me")}</span>}
  {message.deleted?<p className="text-sm italic text-fg-muted">{ct("chatc.deleted")}</p>:message.body&&<p className="whitespace-pre-wrap text-sm leading-relaxed">{mentionNames.length?splitMentions(message.body,mentionNames).map((piece,i)=>piece.mention?<span key={i} data-mention className="rounded bg-accent/10 px-0.5 font-semibold text-accent">{piece.text}</span>:<React.Fragment key={i}>{piece.text}</React.Fragment>):message.body}</p>}
  {message.poll&&!message.deleted&&<PollCard messageId={message.id} poll={message.poll}/>}
  {message.work?.length?<div className="mt-1 flex flex-wrap gap-1">{message.work.map(w=>w.kind==="task"?<a key={w.id} href={`/tasks/${w.id}`} className="inline-flex min-h-8 items-center rounded-full bg-accent/10 px-2 text-xs font-semibold text-accent">{ct("chatc.work.open_task")}</a>:<button key={w.id} type="button" onClick={()=>onOpenWork?.("ticket",w.id)} className="inline-flex min-h-8 items-center rounded-full bg-info/10 px-2 text-xs font-semibold text-info">{ct("chatc.work.open_ticket")}</button>)}</div>:null}
  {message.attachments.map(file=>{const url=safeMediaUrl(file.url); if(!url)return <a key={file.id} href="#" aria-disabled="true">{file.name}</a>; if(message.kind==="VOICE"&&file.mime.startsWith("audio/"))return <VoicePlayer key={file.id} src={url} peaks={file.peaks} durationMs={file.durationMs}/>; return <div key={file.id} className="my-1.5"><a href={url} download={file.name} className="text-xs underline">{ct("chatc.download",{name:file.name})}</a>{file.kind==="IMAGE"&&file.mime.startsWith("image/")&&<img src={url} alt={file.name} loading="lazy" className="mt-1 max-h-80 max-w-full rounded-lg"/>}{file.kind==="VIDEO"&&file.mime.startsWith("video/")&&<video src={url} controls preload="metadata" className="mt-1 max-h-80 max-w-full rounded-lg"/>}{file.kind==="AUDIO"&&file.mime.startsWith("audio/")&&<audio src={url} controls preload="metadata" className="mt-1 w-full"/>}</div>})}
  {message.reactions.length>0&&<div className="mt-1.5 flex flex-wrap gap-1">{message.reactions.map(r=><button key={r.emoji} type="button" disabled={!canAct} aria-pressed={r.mine} aria-label={ct("chatc.reaction",{emoji:r.emoji,count:r.count})} onClick={()=>onReact(message,r.emoji)} className={`min-h-8 rounded-full border px-2 text-sm ${r.mine?"border-accent bg-accent/10":"border-border"}`}>{r.emoji} {r.count}</button>)}</div>}
  {timeLine}
 </>;
 if(classic) return <div className="group mb-3" data-message-row={message.mine?"mine":"other"}>
 <div className={`flex items-end gap-1 ${message.mine?"flex-row-reverse":"flex-row"}`}>
 <article dir="rtl" data-message-id={message.id} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={endPress} onContextMenu={e=>{if(sheetOpen||press.current)e.preventDefault();}} className={`max-w-[85%] min-w-0 break-words rounded-2xl border px-3 py-2 [@media(hover:none)]:select-none ${message.mine?"border-accent/30 bg-accent/10":"border-border bg-surface"}`}>
 {groupStart&&<p className="mb-1 text-xs text-fg-muted">{message.authorName}</p>}
 {content}
 </article>
 {menu}
 </div>
 <ReaderRow readers={readers}/></div>;
 return <div className={`group ${groupEnd?"mb-2.5":"mb-0.5"}`} data-message-row={message.mine?"mine":"other"} data-run={run}>{/* In RTL the first child sits at the right: «mine» reverses the row so the bubble starts at the left, the others keep the row so it starts at the right. */}
 <div className={`flex items-end gap-1.5 ${message.mine?"flex-row-reverse":"flex-row"}`}>
 {!message.mine&&(groupEnd?<Avatar name={message.authorName} src={message.authorAvatar} className="mb-1 size-7 text-xs"/>:<span aria-hidden="true" className="size-7 shrink-0"/>)}
 <div className={`flex min-w-0 flex-col ${message.mine?"items-end":"items-start"}`}>
 {!message.mine&&groupStart&&<p className="mb-0.5 px-1 text-xs font-semibold text-fg-muted">{message.authorName}</p>}
 <div className="flex min-w-0 max-w-full items-end gap-1">
 <article dir="rtl" data-message-id={message.id} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPress} onPointerCancel={endPress} onContextMenu={e=>{if(sheetOpen||press.current)e.preventDefault();}} className={bubble}>
  {content}
 </article>
 {menu}
 </div>
 </div>
 </div>
 <ReaderRow readers={readers}/></div>;
}
