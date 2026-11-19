"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Film, Pin, Play, Ticket } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import type { LinkItemDto, MediaItemDto, MediaPageDto, WorkTaskDto, WorkTicketDto } from "@/server/chat/media";
import { MediaViewerContext, MediaViewerProvider, safeMediaUrl, viewerItemsOfMedia } from "@/components/chat/v2/media-viewer";
import { useInfoJump } from "@/components/chat/v2/info/info-jump";
import { ct } from "@/lib/chat/text";
import { activeTabOf, isPagedTab, safeLinkHref, tabAfterKey, tabsOf, type InfoTab, type InfoTabId, type PagedTab } from "@/lib/chat/v2/info/info-tabs";
import { useConversationWork, useMediaCounts, useMediaPages, useRefreshOnMessages } from "@/lib/chat/v2/info/use-info-tabs";
import { chatHref } from "@/lib/chat/v2/routes";
import { fmtShort, fmtSize, fmtTime, dayDiff } from "@/lib/format";

// the ticket's own window (comments and activity) is heavy and only opened by a tap
const TicketDetailModal = dynamic(() => import("@/components/ticket-detail-modal").then((m) => m.TicketDetailModal), { ssr: false });

const rowBox = "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const pillButton = "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

const whenOf = (at: string): string => (dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at));
const NO_MESSAGES: never[] = [];

/**
 * C3d — THE INFO PANEL'S TABS «الوسائط · الملفات · الروابط · الصوتيات · الشغل · المثبّتة». Only the tabs that have something in them are drawn (the counts and the work
 * come from the two doors of `src/server/chat/media.ts`, the pinned from the header): a conversation with no pictures has no «الوسائط», and one with nothing at all
 * draws nothing — no empty tab, no placeholder. A tab's list is asked for only while it is the one shown, newest first, with «عرض المزيد».
 *
 * «اعرض بالمحادثة» scrolls the open conversation to the message (the pane provides how; the phone's info screen has no pane, so it goes to `/chat/<id>?m=<message>`).
 * The server decided what each list holds; nothing here filters a privacy rule again.
 */
export function InfoTabs({ header }: { header: ConversationHeaderDto }) {
  const router = useRouter();
  const provided = useInfoJump();
  const jump = React.useCallback(
    (messageId: string) => {
      if (provided) provided(messageId);
      else router.push(`${chatHref.conversation(header.id)}?m=${encodeURIComponent(messageId)}`);
    },
    [provided, router, header.id],
  );
  useRefreshOnMessages(header.id);
  const counts = useMediaCounts(header.id);
  const work = useConversationWork(header.id);
  const pinned = header.pinnedMessages ?? NO_MESSAGES;
  const tabs = tabsOf({ counts, work: work.data ? { tasks: work.data.tasks.length, tickets: work.data.tickets.length } : null, pinned: pinned.length });
  const [chosen, setChosen] = React.useState<InfoTabId | null>(null);
  const active = activeTabOf(tabs, chosen);
  if (!active) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = tabAfterKey(tabs, active, event.key);
    if (!next) return;
    event.preventDefault();
    setChosen(next);
    // the roving focus follows the choice
    requestAnimationFrame(() => document.getElementById(`info-tab-${next}`)?.focus());
  };

  return (
    <section data-info-tabs className="border-t border-border">
      <div role="tablist" aria-label={ct("chatinfo.tabs.label")} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto px-2 py-1">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} selected={tab.id === active} onSelect={() => setChosen(tab.id)} />
        ))}
      </div>
      <div role="tabpanel" id={`info-panel-${active}`} aria-labelledby={`info-tab-${active}`} data-info-tab-panel={active} className="px-2 pb-3 pt-1">
        {isPagedTab(active) ? (
          <PagedPanel key={active} header={header} tab={active} jump={jump} />
        ) : active === "work" ? (
          <WorkPanel header={header} jump={jump} tasks={work.data?.tasks ?? []} tickets={work.data?.tickets ?? []} />
        ) : (
          <PinnedPanel pins={pinned} jump={jump} />
        )}
      </div>
    </section>
  );
}

function TabButton({ tab, selected, onSelect }: { tab: InfoTab; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      id={`info-tab-${tab.id}`}
      aria-selected={selected}
      aria-controls={`info-panel-${tab.id}`}
      tabIndex={selected ? 0 : -1}
      data-info-tab={tab.id}
      onClick={onSelect}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected ? "bg-accent/10 font-semibold text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
    >
      <span>{ct(tab.labelKey)}</span>
      <span aria-hidden="true" className="text-xs">
        {tab.count}
      </span>
    </button>
  );
}

// ───────────────────────────── the four paged tabs ─────────────────────────────

function PagedPanel({ header, tab, jump }: { header: ConversationHeaderDto; tab: PagedTab; jump: (messageId: string) => void }) {
  const query = useMediaPages(header.id, tab, true);
  const pages: MediaPageDto[] = query.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const links = pages.flatMap((p) => p.links);
  const empty = items.length === 0 && links.length === 0;
  return (
    <div data-info-list={tab}>
      {query.isError && empty ? (
        <p role="alert" className="flex flex-col items-center gap-2 p-3 text-center text-sm text-fg-muted">
          {ct("chatinfo.failed")}
          <button type="button" onClick={() => void query.refetch()} className={pillButton}>
            {ct("chatinfo.retry")}
          </button>
        </p>
      ) : query.isPending ? (
        <p role="status" className="p-3 text-center text-sm text-fg-muted">
          {ct("chatinfo.loading")}
        </p>
      ) : tab === "media" ? (
        <MediaGrid header={header} items={items} />
      ) : tab === "files" ? (
        <FileRows items={items} jump={jump} />
      ) : tab === "voice" ? (
        <VoiceRows items={items} jump={jump} />
      ) : (
        <LinkRows links={links} jump={jump} />
      )}
      {query.hasNextPage ? (
        <button type="button" data-info-more onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage} className={`${pillButton} mt-2`}>
          {query.isFetchingNextPage ? ct("chatinfo.loading") : ct("chatinfo.more")}
        </button>
      ) : null}
    </div>
  );
}

/** The grid of pictures and videos; a tap opens the viewer (the pane's own when there is one, so it also steps through what is loaded in the conversation). */
function MediaGrid({ header, items }: { header: ConversationHeaderDto; items: MediaItemDto[] }) {
  const source = React.useContext(MediaViewerContext);
  const jump = useInfoJump();
  const grid = <Tiles header={header} items={items} />;
  // outside a pane (the phone's info screen) the viewer is a provider of its own, fed only by the route
  return source ? grid : <MediaViewerProvider messages={NO_MESSAGES} conversationId={header.id} {...(jump ? { onShowInChat: jump } : {})}>{grid}</MediaViewerProvider>;
}

function Tiles({ header, items }: { header: ConversationHeaderDto; items: MediaItemDto[] }) {
  const source = React.useContext(MediaViewerContext);
  const viewerItems = React.useMemo(() => viewerItemsOfMedia(items), [items]);
  return (
    <ul className="grid grid-cols-3 gap-1">
      {items.map((item) => {
        const src = safeMediaUrl(item.attachment.url);
        if (!src) return null;
        const video = item.attachment.kind === "VIDEO";
        return (
          <li key={item.id}>
            <button
              type="button"
              data-info-media-item={item.id}
              aria-label={ct(video ? "chatinfo.media.video" : "chatinfo.media.open", { name: item.attachment.name })}
              onClick={() => source?.open?.({ startId: item.id, fallback: viewerItems, canReadImages: header.imageOcr === true })}
              className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {video ? (
                <>
                  <Film aria-hidden="true" className="size-8 text-fg-muted" />
                  <span aria-hidden="true" className="absolute bottom-1 end-1 grid size-6 place-items-center rounded-full bg-scrim text-on-photo">
                    <Play className="size-3" />
                  </span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked above); a small tile of the real file
                <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Meta({ authorName, at }: { authorName: string; at: string }) {
  return (
    <span className="block truncate text-xs text-fg-muted">
      <bdi>{authorName}</bdi> · {whenOf(at)}
    </span>
  );
}

function ShowButton({ messageId, jump }: { messageId: string; jump: (messageId: string) => void }) {
  return (
    <button type="button" data-info-show={messageId} onClick={() => jump(messageId)} className="shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-accent hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      {ct("chatinfo.show")}
    </button>
  );
}

function FileRows({ items, jump }: { items: MediaItemDto[]; jump: (messageId: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const href = safeMediaUrl(item.attachment.url);
        return (
          <li key={item.id} className="flex items-center gap-1">
            {href ? (
              <a href={href} download={item.attachment.name} aria-label={ct("chatinfo.file.download", { name: item.attachment.name })} className={`${rowBox} min-w-0 flex-1`}>
                <FileText aria-hidden="true" className="size-6 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate">{item.attachment.name}</bdi>
                  <span className="block truncate text-xs text-fg-muted">
                    {fmtSize(item.attachment.size)} · <bdi>{item.authorName}</bdi> · {whenOf(item.at)}
                  </span>
                </span>
              </a>
            ) : null}
            <ShowButton messageId={item.messageId} jump={jump} />
          </li>
        );
      })}
    </ul>
  );
}

function VoiceRows({ items, jump }: { items: MediaItemDto[]; jump: (messageId: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const src = safeMediaUrl(item.attachment.url);
        return (
          <li key={item.id} className="flex flex-col gap-1 py-2">
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 px-2">
                <Meta authorName={item.authorName} at={item.at} />
              </span>
              <ShowButton messageId={item.messageId} jump={jump} />
            </span>
            {src ? <audio controls preload="none" src={src} aria-label={ct("chatinfo.voice.player", { name: item.attachment.name })} className="h-10 w-full" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function LinkRows({ links, jump }: { links: LinkItemDto[]; jump: (messageId: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {links.map((link) => {
        const href = safeLinkHref(link.url);
        const text = (
          <span className="min-w-0 flex-1">
            <bdi className="block truncate font-semibold">{link.title ?? link.url}</bdi>
            <bdi className="block truncate text-xs text-accent">{link.siteName ?? link.url}</bdi>
            <Meta authorName={link.authorName} at={link.at} />
          </span>
        );
        return (
          <li key={link.id} className="flex items-center gap-1">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={ct("chatinfo.link.open", { url: link.url })} className={`${rowBox} min-w-0 flex-1`}>
                {text}
              </a>
            ) : (
              // not an ordinary web address: shown, never a link
              <div className={`${rowBox} min-w-0 flex-1 hover:bg-transparent`}>{text}</div>
            )}
            <ShowButton messageId={link.messageId} jump={jump} />
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────────── «الشغل» and «المثبّتة» ─────────────────────────────

function WorkPanel({ header, jump, tasks, tickets }: { header: ConversationHeaderDto; jump: (messageId: string) => void; tasks: WorkTaskDto[]; tickets: WorkTicketDto[] }) {
  const [ticketId, setTicketId] = React.useState<string | null>(null);
  return (
    <div data-info-list="work" className="space-y-3">
      {tasks.length > 0 ? (
        <section data-info-work="tasks">
          <h4 className="px-2 py-1 text-xs font-semibold text-fg-muted">{ct("chatinfo.work.tasks")}</h4>
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-1">
                <Link href={`/tasks/${encodeURIComponent(task.id)}`} className={`${rowBox} min-w-0 flex-1`}>
                  {task.done ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" /> : <span aria-hidden="true" className="size-5 shrink-0 rounded-full border border-border" />}
                  <span className="min-w-0 flex-1">
                    <bdi className={`block truncate ${task.done ? "text-fg-muted line-through" : ""}`}>{task.title}</bdi>
                    <span className="block truncate text-xs text-fg-muted">
                      <bdi>{task.key}</bdi>
                      {task.assigneeName ? <> · <bdi>{task.assigneeName}</bdi></> : null}
                      {task.done ? <> · {ct("chatinfo.work.done")}</> : null}
                    </span>
                  </span>
                </Link>
                <ShowButton messageId={task.messageId} jump={jump} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {tickets.length > 0 ? (
        <section data-info-work="tickets">
          <h4 className="px-2 py-1 text-xs font-semibold text-fg-muted">{ct("chatinfo.work.tickets")}</h4>
          <ul className="divide-y divide-border">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-1">
                <button type="button" data-info-ticket={ticket.id} onClick={() => setTicketId(ticket.id)} className={`${rowBox} min-w-0 flex-1`}>
                  <Ticket aria-hidden="true" className="size-5 shrink-0 text-info" />
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate">{ticket.title}</bdi>
                    <span className="block truncate text-xs text-fg-muted">
                      <bdi>{ticket.key}</bdi> · {ct(`tickets.chip.${ticket.status.toLowerCase()}`)}
                      {ticket.assigneeName ? <> · {ct("tickets.chip.with")} <bdi>{ticket.assigneeName}</bdi></> : null}
                    </span>
                  </span>
                </button>
                <ShowButton messageId={ticket.messageId} jump={jump} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ticketId && header.me.id ? <TicketDetailModal ticketId={ticketId} currentUserId={header.me.id} onClose={() => setTicketId(null)} /> : null}
    </div>
  );
}

function PinnedPanel({ pins, jump }: { pins: NonNullable<ConversationHeaderDto["pinnedMessages"]>; jump: (messageId: string) => void }) {
  return (
    <ul data-info-list="pinned" className="divide-y divide-border">
      {pins.map((pin) => (
        <li key={pin.id}>
          <button type="button" data-info-pinned={pin.id} onClick={() => jump(pin.id)} className={rowBox}>
            <Pin aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1">
              <bdi className="block truncate text-xs text-fg-muted">{pin.authorName}</bdi>
              <span className="line-clamp-2 break-words">{pin.preview ?? ct("chatinfo.pinned.empty_preview")}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
