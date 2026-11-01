"use client";
import React from "react";
import type { ConversationDto, MessageDto, ReaderDto } from "@/server/chat/dto";
import { conversationDetailUrl, isAtBottom, onNewest } from "@/lib/chat/conversation/client";
import { MessageItem, TypingLine } from "@/components/chat/message/message-item";
import { dayLabelOf, opensDay } from "@/lib/chat/day-separator";
import { ChatComposer, type OutboxRestore } from "@/components/chat/composer/chat-composer";
import { OutboxStatusLine } from "@/components/chat/composer/outbox-status";
import { PendingBubble } from "@/components/chat/message/pending-bubble";
import { useOnline, useOutbox } from "@/lib/chat/outbox/use-outbox";
import type { OutboxItem } from "@/lib/chat/outbox/queue";
import { isMentioned, MENTION_ALL_NAME } from "@/lib/chat/conversation/mentions";
import { runFlags } from "@/lib/chat/group";
import { playChatSound, soundOfArrival } from "@/lib/chat/sounds";
import { useRealtime, useTyping } from "@/lib/realtime/use-realtime";
import { announceChatRead } from "@/lib/chat/use-chat-unread";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { ForwardDialog, NoteDialog } from "@/components/chat/message/message-dialogs";
import type { MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { ct, ctCount } from "@/lib/chat/text";
import { TopicSettingsDialog } from "./topic-settings-dialog";
import { ConversationHeader } from "./conversation-header";
import { dmSubtitle } from "@/lib/chat/conversation/last-seen-line";
import { ConversationSearch } from "./conversation-search";
import { CallButton } from "@/components/calls/call-button";
import { MakeWorkDialog, titleOf, type WorkKind } from "@/components/chat/message/make-work-dialog";
import { RemindDialog } from "@/components/reminders/remind-dialog";
import { TicketDetailModal } from "@/components/ticket-detail-modal";
import Link from "next/link";
export interface ConversationScreenProps { conversationId: string; onBack: () => void; onOpenSettings?: () => void;
  /** open around this message (a search hit, `?m=`), scrolled to it and marked */
  focusMessageId?: string }
/**
 * What sits under the messages: the composer whenever the server says I may post (`me.canPost` already
 * covers closed, muted, guests and «للمشرفين فقط» — a space admin posts in the announcements), else the
 * owner's «شارك بالمحادثة», else the one line that says why not.
 */
export type ComposerBar = "composer" | "join" | "oversight" | "closed" | "muted" | "announcements" | "denied";
export function composerBarOf(me: ConversationDto["me"], conv: Pick<ConversationDto, "closed" | "topicType">): ComposerBar {
 if (me.canPost) return "composer";
 if (me.canJoin) return "join";
 if (me.oversight) return "oversight";
 if (conv.closed) return "closed";
 if (me.muted) return "muted";
 if (conv.topicType === "ANNOUNCEMENTS") return "announcements";
 return "denied";
}
/** The one reason line under the messages, from ar.chat-conversation.json (`chatc.bar.*`). */
const barText = (bar: Exclude<ComposerBar, "composer" | "join">): string => ct(`chatc.bar.${bar}`);
/** A message appended to the log unless the log already has it (the answer to my send and the live refetch can both bring it). */
export function appendOnce(current: MessageDto[], message: MessageDto): MessageDto[] {
 return current.some(m=>m.id===message.id)?current:[...current,message];
}
/** The queued items of a conversation that the log does not draw yet: one whose `clientId` is already a real message is that message (a refetch won the race). */
export function pendingToDraw(items: readonly OutboxItem[], conversationId: string, messages: readonly MessageDto[]): OutboxItem[] {
 const known=new Set(messages.map(m=>m.clientId).filter((c):c is string=>Boolean(c)));
 return items.filter(i=>i.conversationId===conversationId&&!known.has(i.clientId));
}
export function ConversationScreen({ conversationId, onBack, focusMessageId }: ConversationScreenProps) {
 const [detail,setDetail]=React.useState<ConversationDto|null>(null); const [messages,setMessages]=React.useState<MessageDto[]>([]); const [reply,setReply]=React.useState<MessageDto|null>(null); const [editing,setEditing]=React.useState<MessageDto|null>(null); const [loading,setLoading]=React.useState(true); const [error,setError]=React.useState("");
 const lastMarked=React.useRef<string|null>(null);
 // the message the page is opened around (a search hit): older messages, until «رجوع لآخر الرسائل»
 const [anchor,setAnchor]=React.useState<string|null>(focusMessageId??null);
 const [searching,setSearching]=React.useState(false);
 // «اعمل منها مهمة/تذكرة», and a ticket opened from a «صارت تذكرة» chip
 const [making,setMaking]=React.useState<{message:MessageDto;kind:WorkKind}|null>(null);
 const [ticketOpen,setTicketOpen]=React.useState<string|null>(null);
 // the pinned bar: each tap goes to the next pinned message (newest first), like a messaging app
 const [pinIndex,setPinIndex]=React.useState(0);
 // `silent`: a live update (another person's message, an edit, a reaction) refetches without the loading line
 const refresh=React.useCallback(async(opts:{silent?:boolean}={})=>{if(!opts.silent)setLoading(true);setError("");try{const response=await fetch(conversationDetailUrl(conversationId,undefined,anchor??undefined),{cache:"no-store"});/* a message that is gone (an old link): open the conversation at its newest instead */if(!response.ok&&anchor&&response.status===404){setAnchor(null);return;}
if(!response.ok)throw new Error(ct("chatc.load_failed"));const data=await response.json() as ConversationDto;setDetail(data);setMessages(data.messages);const last=data.messages.at(-1);/* mark read only for a message not marked yet: a read mark is itself a live event, and re-marking on it would loop
   (and never while reading older messages around a search hit: the newest are not on the screen) */if(!anchor&&!data.me.oversight&&last&&lastMarked.current!==last.id){lastMarked.current=last.id;void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read?upTo=${encodeURIComponent(last.id)}`,{method:"POST"}).then(r=>{if(r.ok)announceChatRead();},()=>undefined);}}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}finally{setLoading(false);}},[conversationId,anchor]);
 // around a search hit: bring it into view and mark it for a moment
 React.useEffect(()=>{if(!anchor||loading)return;const el=document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor)}"]`);if(!el)return;el.scrollIntoView({block:"center"});el.classList.add("ring-2","ring-accent");const t=setTimeout(()=>el.classList.remove("ring-2","ring-accent"),2500);return()=>clearTimeout(t);},[anchor,loading]); React.useEffect(()=>{void refresh();},[refresh]);
 // where the newest message leaves the view: down to it on opening, on one's own message and when already there;
 // up reading older ones, the view stays and «↓ رسائل جديدة» counts what came (src/lib/chat/conversation/client.ts)
 const logRef=React.useRef<HTMLDivElement>(null); const atBottomRef=React.useRef(true); const openingRef=React.useRef(true); const newestRef=React.useRef<string|null>(null); const [below,setBelow]=React.useState(0); const [awayFromBottom,setAwayFromBottom]=React.useState(false);
 React.useEffect(()=>{openingRef.current=true;newestRef.current=null;atBottomRef.current=true;setBelow(0);setAwayFromBottom(false);},[conversationId]);
 const toBottom=React.useCallback((smooth=false)=>{const el=logRef.current;if(!el)return;el.scrollTo({top:el.scrollHeight,behavior:smooth?"smooth":"auto"});atBottomRef.current=true;setBelow(0);setAwayFromBottom(false);/* pictures and voice notes grow after they load: follow them down once more */requestAnimationFrame(()=>{if(atBottomRef.current&&logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;});},[]);
 React.useLayoutEffect(()=>{if(loading)return;const newest=messages.at(-1);if(!newest||newest.id===newestRef.current)return;const first=newestRef.current===null;newestRef.current=newest.id;const arrival=soundOfArrival({mine:Boolean(newest.mine),opening:openingRef.current&&first,mentionsMe:Boolean(detail?.me.id)&&isMentioned(newest.mentions,detail?.me.id??""),kind:newest.kind});if(arrival)playChatSound(arrival);const where=onNewest({opening:openingRef.current&&first,mine:Boolean(newest.mine),atBottom:atBottomRef.current,aroundHit:Boolean(anchor)});openingRef.current=false;if(where==="bottom")toBottom();else if(where==="badge")setBelow(n=>n+1);},[messages,loading,anchor,toBottom,detail?.me.id]);
 const onLogScroll=React.useCallback(()=>{const el=logRef.current;if(!el)return;const at=isAtBottom(el);atBottomRef.current=at;setAwayFromBottom(!at);if(at)setBelow(0);},[]);
 // Live: any event of THIS conversation (or a synthetic one with no conversation: the polling fallback,
 // a reconnect `reload`) refetches it quietly; a burst of events is folded into one refetch.
 const liveTimer=React.useRef<ReturnType<typeof setTimeout>|null>(null);
 React.useEffect(()=>()=>{if(liveTimer.current)clearTimeout(liveTimer.current);},[]);
 useRealtime((event)=>{if(event.conversationId&&event.conversationId!==conversationId)return;if(event.kind==="typing"||event.kind==="whiteboard.changed")return;if(liveTimer.current)clearTimeout(liveTimer.current);liveTimer.current=setTimeout(()=>{liveTimer.current=null;void refresh({silent:true});},250);});
 async function action(message:MessageDto,path:string,method="POST",body?:unknown){try{const response=await fetch(path,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(ct("chatc.action_failed"));if(method==="DELETE"){setMessages(current=>current.map(m=>m.id===message.id?{...m,deleted:true,body:null}:m));}else await refresh({silent:true});}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}}
 // «شارك بالمحادثة»: the owner leaves silent oversight for this topic; the composer appears and the join line reaches everybody live
 const [joining,setJoining]=React.useState(false);
 async function join(){setJoining(true);setError("");try{const response=await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/join`,{method:"POST"});if(!response.ok)throw new Error(ct("chatc.join_failed"));await refresh({silent:true});}catch(e){setError(e instanceof Error?e.message:ct("chatc.failed"));}finally{setJoining(false);}}
 // the ONE message menu: every action of every bubble arrives here
 const toast=useOptionalToast();
 const say=(key:string,kind:"success"|"error"="success")=>{const text=ct(key);if(toast)toast.toast(text,kind);else if(kind==="error")setError(text);};
 const [forwarding,setForwarding]=React.useState<MessageDto|null>(null);
 const [noting,setNoting]=React.useState<MessageDto|null>(null);
 const [reminding,setReminding]=React.useState<MessageDto|null>(null);
 // «الرسائل بدون نت»: a send that could not leave stays in the person's outbox and is drawn here as a pending bubble; never for the owner's silent reading (he posts nothing there)
 const outboxOn=detail?.chatOutbox!==false&&Boolean(detail?.me.canPost)&&!detail?.me.oversight;
 const {outbox,items:outboxItems}=useOutbox(detail?.me.id,outboxOn);
 const online=useOnline();
 const pending=React.useMemo(()=>pendingToDraw(outboxItems,conversationId,messages),[outboxItems,conversationId,messages]);
 const waitingCount=pending.filter(i=>!i.failed).length;
 const failedCount=pending.length-waitingCount;
 const [restore,setRestore]=React.useState<OutboxRestore|null>(null);
 // when the queue gets a message through, the real message takes the pending bubble's place in the same render (reconciled by clientId)
 React.useEffect(()=>outbox?outbox.onSent((item,message)=>{if(item.conversationId===conversationId)setMessages(current=>appendOnce(current,message));}):undefined,[outbox,conversationId]);
 const pendingCount=pending.length;const pendingSeen=React.useRef(0);
 React.useEffect(()=>{if(pendingCount>pendingSeen.current&&!anchor)toBottom();pendingSeen.current=pendingCount;},[pendingCount,anchor,toBottom]);
 function copyPending(item:OutboxItem){void navigator.clipboard?.writeText(item.body).then(()=>say("outbox.copied"),()=>say("outbox.copy_failed","error"));}
 function editPending(item:OutboxItem){setRestore({id:item.clientId,body:item.body,mentions:item.mentions});outbox?.remove(item.clientId);}
 function onAction(message:MessageDto,id:MessageMenuId){
  const at=`/api/chat/messages/${encodeURIComponent(message.id)}`;
  if(id==="reply"){setEditing(null);setReply(message);}
  else if(id==="pin")void action(message,`${at}/pin`);
  else if(id==="forward")setForwarding(message);
  else if(id==="edit"){setReply(null);setEditing(message);}
  else if(id==="note")setNoting(message);
  else if(id==="remind")setReminding(message);
  else if(id==="task"||id==="ticket")setMaking({message,kind:id});
  else if(id==="delete")void action(message,at,"DELETE");
  else if(id==="copy")void navigator.clipboard?.writeText(message.body??"").then(()=>say("chatc.menu.copied"),()=>say("chatc.menu.failed","error"));
 }
 // «إعدادات الموضوع»: its privacy (who sees and reads it, who writes) — for whoever moderates the topic
 const [settings,setSettings]=React.useState(false);
 const canSet=detail?.kind==="TOPIC"&&Boolean(detail?.me.canModerate);
 const oversight=Boolean(detail?.me.oversight);
 const bar=detail?composerBarOf(detail.me,detail):"composer";
 // each reader's avatar under the newest message they read (the server leaves out the viewer and the owner)
 const {typingNames}=useTyping(conversationId);
 const mentionNames=React.useMemo(()=>[...(detail?.mentionables??detail?.members??[]).map(m=>m.name),MENTION_ALL_NAME],[detail]);
 const readersByMessage=React.useMemo(()=>{const map=new Map<string,ReaderDto[]>();for(const r of detail?.readers??[]){const list=map.get(r.messageId)??[];list.push(r);map.set(r.messageId,list);}return map;},[detail]);
 return <section dir="rtl" lang="ar" className="flex h-full min-h-0 flex-col" aria-label={ct("chatc.title_fallback")}><ConversationHeader conversationId={conversationId} title={`${detail?.emoji?`${detail.emoji} `:""}${detail?.title??ct("chatc.title_fallback")}`} subtitle={dmSubtitle(detail)??detail?.space?.name??(detail?.members?ctCount("chatc.members",detail.members.length):"")} call={detail&&detail.calls!==false?<CallButton conversationId={conversationId} isDm={detail.kind==="DM"} canStart={detail.me.canPost&&detail.me.canCall!==false}/>:null} searching={searching} onSearch={()=>setSearching(v=>!v)} canSet={canSet} onSettings={()=>setSettings(true)} onBack={onBack} whiteboard={detail?.whiteboard!==false}/>{detail&&canSet&&<TopicSettingsDialog open={settings} onOpenChange={setSettings} topic={detail} onSaved={()=>void refresh({silent:true})}/>}{(()=>{const pins=detail?.pinnedMessages??[];if(!pins.length)return null;const i=pinIndex%pins.length;const pin=pins[i]!;return <button type="button" aria-label={ct("chatc.pinbar.label")} onClick={()=>{setAnchor(pin.id);setPinIndex(i+1);}} className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-surface-1 px-3 py-1 text-start hover:bg-surface-2"><span aria-hidden="true">📌</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-accent">{ct("chatc.pinbar.label")}{pins.length>1?` · ${ct("chatc.pinbar.count",{i:i+1,n:pins.length})}`:""}</span><span className="block truncate text-sm">{pin.authorName}: {pin.preview??ct("chatc.pinbar.empty_preview")}</span></span></button>;})()}{searching&&<ConversationSearch conversationId={conversationId} onClose={()=>setSearching(false)} onPick={id=>{setSearching(false);setAnchor(id);}}/>}{anchor&&<p className="flex items-center justify-between gap-2 border-b border-border p-2 text-sm"><span>{ct("chatc.search.older")}</span><button type="button" onClick={()=>setAnchor(null)} className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-accent hover:bg-surface-2">{ct("chatc.search.latest")}</button></p>}{oversight&&<p className="border-b border-border p-2 text-center">{ct("chatc.oversight_banner")}</p>}{detail?.space?.hasExternal&&<p className="p-2 text-sm">{ct("chatc.external")}</p>}
 <div className="relative flex min-h-0 flex-1 flex-col"><div ref={logRef} onScroll={onLogScroll} role="log" aria-live="polite" aria-label={ct("chatc.log")} data-conversation-id={conversationId} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3 md:p-3">{loading&&<p role="status">{ct("chatc.loading")}</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!messages.length&&!pending.length&&<p>{ct("chatc.empty")}</p>}{messages.map((message,index)=><React.Fragment key={message.id}>{detail?.chatBubbles!==false&&opensDay(message.createdAt,messages[index-1]?.createdAt??null)&&<p data-day-separator className="my-3 text-center text-xs font-semibold text-fg-muted"><span className="rounded-full bg-surface-1 px-3 py-1">{dayLabelOf(message.createdAt)}</span></p>}<MessageItem message={message} groupStart={runFlags(messages,index).start} groupEnd={runFlags(messages,index).end} classic={detail?.chatBubbles===false} meId={detail?.me.id} mentionNames={mentionNames} readers={readersByMessage.get(message.id)} oversight={oversight} canModerate={Boolean(detail?.me.canModerate)} conversationKind={detail?.kind} canPost={Boolean(detail?.me.canPost)} canMakeWork={Boolean(detail?.me.canMakeWork)} canMakeTask={detail?.me.canMakeTask} canMakeTicket={detail?.me.canMakeTicket} canRemind={Boolean(detail?.me.canRemind)} onOpenWork={(_kind,id)=>setTicketOpen(id)} onReact={(m,emoji)=>void action(m,`/api/chat/messages/${encodeURIComponent(m.id)}/react`,"POST",{emoji})} onAction={onAction}/></React.Fragment>)}{pending.map(item=><PendingBubble key={item.clientId} item={item} onRetry={i=>outbox?.retryNow(i.clientId)} onDelete={i=>outbox?.remove(i.clientId)} onCopy={copyPending} onEdit={editPending}/>)}</div>{(awayFromBottom||below>0)&&!anchor&&<button type="button" onClick={()=>toBottom(true)} aria-label={below>0?ctCount("chatc.new_below",below):ct("chatc.to_newest")} className="absolute bottom-3 end-3 z-10 inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface-1 px-3 text-sm font-semibold text-accent shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none"><span aria-hidden="true">↓</span>{below>0?ctCount("chatc.new_below",below):ct("chatc.to_newest")}</button>}</div><MakeWorkDialog message={making?.message??null} kind={making?.kind??"task"} onClose={()=>setMaking(null)} onDone={made=>{setMaking(null);say(made.kind==="task"?"chatc.work.task_made":"chatc.work.ticket_made");void refresh({silent:true});}}/>{ticketOpen&&detail?.me.id&&<TicketDetailModal ticketId={ticketOpen} currentUserId={detail.me.id} onClose={()=>setTicketOpen(null)}/>}<ForwardDialog message={forwarding} from={conversationId} onClose={()=>setForwarding(null)} onDone={ok=>{setForwarding(null);say(ok?"chatc.menu.forwarded":"chatc.menu.failed",ok?"success":"error");}}/><NoteDialog message={noting} onClose={()=>setNoting(null)} onDone={ok=>{setNoting(null);say(ok?"chatc.menu.note_saved":"chatc.menu.failed",ok?"success":"error");if(ok)void refresh({silent:true});}}/>{reminding&&<RemindDialog open onClose={()=>setReminding(null)} onSaved={()=>{setReminding(null);say("reminder.saved");}} defaultTitle={titleOf(reminding.body)} messageId={reminding.id}/>}
 {detail&&bar!=="composer"?<footer className="border-t border-border p-3 text-center text-sm">{bar==="join"?<div className="flex flex-col items-center gap-1"><Button type="button" onClick={()=>void join()} disabled={joining} className="min-h-11 font-bold">{joining?ct("chatc.joining"):ct("chatc.join")}</Button><p className="text-xs text-fg-muted">{ct("chatc.join_hint")}</p></div>:barText(bar)}</footer>:<footer className="border-t border-border p-3">{detail&&<><TypingLine names={typingNames}/><OutboxStatusLine pending={waitingCount} failed={failedCount} offline={!online}/><ChatComposer conversationId={conversationId} detail={detail} reply={reply} onCancelReply={()=>setReply(null)} outbox={outbox} restore={restore} onRestored={()=>setRestore(null)} onMessage={message=>{setMessages(current=>appendOnce(current,message));setReply(null);toBottom();}} editing={editing} onCancelEdit={()=>setEditing(null)} onEdited={updated=>{setEditing(null);setMessages(current=>current.map(m=>m.id===updated.id?updated:m));}}/>{reply&&<div className="mt-2 flex items-center justify-between"><p>{ct("chatc.reply_to",{name:reply.authorName,body:reply.deleted?ct("chatc.deleted"):(reply.body??"")})}</p><button type="button" aria-label={ct("chatc.cancel_reply")} className="min-h-11 px-2" onClick={()=>setReply(null)}>{ct("chatc.cancel")}</button></div>}</>}</footer>}</section>;
}
