"use client";

import React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Megaphone, MoreVertical, PanelRight, Search } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CallButton } from "@/components/calls/call-button";
import { AssistantCallButton } from "@/components/site-guide/assistant-call-button";
import { TopicSummaryButton } from "@/components/digest/topic-summary-button";
import { PrivacySheet } from "@/components/chat/conversation/privacy-sheet";
import { TopicSettingsDialog } from "@/components/chat/conversation/topic-settings-dialog";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { SelectionBarHost } from "@/components/chat/v2/menu/selection-bar";
import { useSelection } from "@/lib/chat/selection";
import { chatKeys } from "@/lib/chat/cache/keys";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { privacyState } from "@/lib/chat/privacy";
import { ct } from "@/lib/chat/text";
import { isSavedHeader } from "@/lib/chat/v2/menu/menu-context";
import { composerDetailOf, type PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { channelOf, headerMenuOf, subtitleOf, type HeaderMenuId } from "@/lib/chat/v2/pane/header-model";
import { doors } from "@/lib/chat/v2/pane/message-actions";
import { useTyping } from "@/lib/realtime/use-realtime";
import { chatHref } from "@/lib/chat/v2/routes";
import { usePhoneBack } from "@/lib/chat/v2/phone/use-phone-back";

const iconButton = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2";

/** The picture at the start of the header: the other person for a private chat, the topic's emoji in a circle for a topic. */
function HeaderAvatar({ header }: { header: ConversationHeaderDto }) {
  if (header.kind === "DM") return <Avatar name={header.title} src={header.peer?.avatarUrl ?? null} className="size-10 text-sm" />;
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xl">
      {header.emoji ?? "💬"}
    </span>
  );
}

/**
 * C2.4 — THE HEADER of the conversation pane: back (phone) · picture · title · subtitle · actions («🔍», the call button, «⋮»).
 *
 * The picture, the title and its line are ONE block with ONE button over all of it (S5.4; before, only the title text was the button): a press only TOGGLES `infoOpen` in the pane's actions (C2.7 draws the panel in `seams/info-host.tsx`).
 * The line says what the spec says — a private chat: the other person's last seen (the old head's line); a topic: «المساحة · 42 عضو», or «🔒 خاص · 4
 * أشخاص» with the P0.4 wording and NO name (the header carries a count, the names are in the sheet the lock chip opens); «عم يكتب…» whenever somebody
 * types. The «⋮» draws only the items that already have a server door (`headerMenuOf`): «اكتم الإشعارات» has none before C3a, so it is not drawn. The in-app sounds
 * switch is no longer here: it is «أصوات الدردشة جوا التطبيق» in «إعداداتي» (C4.1; the same `zk.chat.sounds` key).
 */
export function PaneHeader({ header, people, watch, system }: { header: ConversationHeaderDto; people: PaneMembers | null; watch: boolean; system: boolean }) {
  const qc = useQueryClient();
  const a = usePaneActions();
  const selection = useSelection();
  const selecting = selection.active && selection.conversationId === header.id;
  const { onLinkClick } = usePhoneBack();
  const { typingNames } = useTyping(header.id);
  // C3a.3: the saved chat has nobody to call and nobody who types: no call button and no typing line there
  const saved = isSavedHeader(header);
  const subtitle = subtitleOf(header, { typingNames: saved ? [] : typingNames, saved });
  // C3c.4: «قناة» with the megaphone, from the topic's own two fields (announcements, only admins post)
  const channel = channelOf(header);
  const [privacyOpen, setPrivacyOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const summaryHolder = React.useRef<HTMLSpanElement>(null);
  // ONE object per header (the settings dialog resets its fields whenever the topic it was given changes, so a new object on every typing line would wipe what is typed)
  const settingsTopic = React.useMemo(() => composerDetailOf(header, people), [header, people]);

  const items = headerMenuOf({
    kind: header.kind,
    whiteboard: header.whiteboard !== false,
    watch,
    digest: header.digest === true,
    canModerate: header.me.canModerate,
    closed: header.closed,
    archived: header.archived === true,
    system,
  });
  const state = privacyState(header);
  const sheetPeople = state === "team" ? (people?.mentionables ?? people?.members ?? []).filter((m) => m.role !== "AI") : (people?.members ?? []);

  /** a topic change: the door, then the header and the feed catch up */
  const topicCall = (patch: { closed?: boolean; archived?: boolean }) =>
    void a.call(doors.topic(header.id, patch), "chath.menu.done").then((ok) => {
      if (ok) void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
    });

  const item = (id: HeaderMenuId): React.ReactNode => {
    switch (id) {
      case "search":
        return (
          <DropdownMenuItem key={id} onSelect={a.openSearch}>
            {ct("chatui.pane.menu.search")}
          </DropdownMenuItem>
        );
      case "whiteboard":
        return (
          <DropdownMenuItem key={id} asChild>
            <Link href={`/chat/${encodeURIComponent(header.id)}/whiteboard`}>{ct("whiteboard.open")}</Link>
          </DropdownMenuItem>
        );
      case "watch":
        return (
          <DropdownMenuItem key={id} asChild>
            <Link href="/watch">{ct("nav.place.watch")}</Link>
          </DropdownMenuItem>
        );
      case "digest":
        return (
          <DropdownMenuItem key={id} onSelect={() => summaryHolder.current?.querySelector<HTMLButtonElement>("[data-topic-summary]")?.click()}>
            {ct("digest.summarize")}
          </DropdownMenuItem>
        );
      case "info":
        return (
          <DropdownMenuItem key={id} onSelect={a.toggleInfo}>
            {ct("chatui.pane.menu.info")}
          </DropdownMenuItem>
        );
      case "settings":
        return (
          <DropdownMenuItem key={id} onSelect={() => setSettingsOpen(true)}>
            {ct("chatc.topic.settings")}
          </DropdownMenuItem>
        );
      case "close":
        return (
          <DropdownMenuItem key={id} onSelect={() => topicCall({ closed: true })}>
            {ct("chatc.topic.close")}
          </DropdownMenuItem>
        );
      case "reopen":
        return (
          <DropdownMenuItem key={id} onSelect={() => topicCall({ closed: false })}>
            {ct("chatc.topic.reopen")}
          </DropdownMenuItem>
        );
      case "archive":
        return (
          <DropdownMenuItem key={id} onSelect={() => topicCall({ archived: true })}>
            {ct("chatc.topic.archive")}
          </DropdownMenuItem>
        );
      case "unarchive":
        return (
          <DropdownMenuItem key={id} onSelect={() => topicCall({ archived: false })}>
            {ct("chatc.topic.unarchive")}
          </DropdownMenuItem>
        );
    }
  };
  const topicIds: HeaderMenuId[] = ["settings", "close", "reopen", "archive", "unarchive"];
  const common = items.filter((id) => !topicIds.includes(id));
  const topic = items.filter((id) => topicIds.includes(id));

  // C3b.5 («حدّد»): while messages of THIS conversation are picked, the bar (the count and «حوّل · انسخ · احذف · اعمل مهمة») takes the header's place; Esc or ✕ gives it back
  if (selecting) {
    return (
      <header data-pane-header className="flex min-h-14 items-center gap-2 border-b border-border bg-surface px-2 pt-[env(safe-area-inset-top)] md:px-3 md:pt-0">
        <SelectionBarHost header={header} />
      </header>
    );
  }

  return (
    // C2.8: on a phone the header owns the notch (the frame's top bar is hidden on a chat screen), so it pads its top by the inset; from `md` there is none
    <header
      data-pane-header
      {...(header.tgLook !== false ? { "data-tg-glass": "" } : {})}
      className={
        header.tgLook !== false
          ? "mx-2 mt-[max(env(safe-area-inset-top),0.5rem)] flex min-h-14 items-center gap-2 rounded-2xl border border-border/60 bg-surface-1/85 px-2 shadow-card backdrop-blur-md md:mx-0 md:mt-0 md:rounded-none md:border-0 md:border-b md:border-border md:bg-surface md:px-3 md:shadow-none md:backdrop-blur-0"
          : "flex min-h-14 items-center gap-2 border-b border-border bg-surface px-2 pt-[env(safe-area-inset-top)] md:px-3 md:pt-0"
      }
    >
      <Link href={chatHref.list} aria-label={ct("chatc.back")} onClick={onLinkClick(chatHref.list)} className={`${iconButton} md:hidden`}>
        <ArrowRight aria-hidden="true" className="size-5" />
      </Link>
      {/* S5.4: the picture, the name and the line under it are ONE block with ONE button stretched over all of it (a tap on any of them opens the info); the lock chip is its own button above it, so no button holds another */}
      <div data-header-identity className="relative flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg">
        <button
          type="button"
          data-header-title
          aria-expanded={a.infoOpen}
          aria-label={ct("chatprof.header.open", { name: header.title })}
          onClick={a.toggleInfo}
          className="absolute inset-0 rounded-lg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <span className="pointer-events-none relative shrink-0">
          <HeaderAvatar header={header} />
        </span>
        <div className="pointer-events-none relative min-w-0 flex-1 text-start">
          {/* S5.5: «موثّق» next to the other person's name in a private chat (the plain title keeps its own shape for everybody else) */}
          {header.kind === "DM" && header.peer?.verified ? (
            <h1 className="flex min-w-0 items-center gap-1 font-semibold leading-tight">
              <span className="truncate">{header.title}</span>
              <VerifiedBadge />
            </h1>
          ) : (
            <h1 className="truncate font-semibold leading-tight">{header.title}</h1>
          )}
          {channel || subtitle.privacy || subtitle.line ? (
            <p data-header-subtitle className={`flex min-w-0 items-center gap-1.5 text-xs ${subtitle.typing ? "text-accent" : "text-fg-muted"}`}>
              {channel && !subtitle.typing ? (
                <span data-header-channel="" className="inline-flex shrink-0 items-center gap-1 font-medium text-accent">
                  <Megaphone aria-hidden="true" className="size-3.5" />
                  {channel}
                </span>
              ) : null}
              {channel && !subtitle.typing && (subtitle.privacy || subtitle.line) ? <span aria-hidden="true">·</span> : null}
              {subtitle.privacy && !subtitle.typing ? (
                <button type="button" data-privacy aria-label={ct("chatp.open_sheet")} onClick={() => setPrivacyOpen(true)} className="pointer-events-auto relative z-10 shrink-0 rounded-md px-1 text-accent hover:bg-surface-2">
                  {subtitle.privacy}
                </button>
              ) : null}
              {subtitle.privacy && !subtitle.typing && subtitle.line ? <span aria-hidden="true">·</span> : null}
              {subtitle.line ? <span className="truncate">{subtitle.line}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <button type="button" data-header-search aria-label={ct("chatui.pane.menu.search")} aria-expanded={a.searchOpen} onClick={a.searchOpen ? a.closeSearch : a.openSearch} className={iconButton}>
        <Search aria-hidden="true" className="size-5" />
      </button>
      {header.assistantCall ? (
        <AssistantCallButton />
      ) : header.calls !== false && !saved ? (
        <CallButton conversationId={header.id} isDm={header.kind === "DM"} canStart={header.me.canPost && header.me.canCall !== false} joinInBar />
      ) : null}
      {/* the owner (2026-11-22), like Telegram: a button that shows and hides the profile panel on the side (a computer only: on a phone the panel is a screen of its own) */}
      <button
        type="button"
        data-header-info-toggle
        aria-pressed={a.infoOpen}
        aria-label={ct("chatprof.header.toggle")}
        title={ct("chatprof.header.toggle")}
        onClick={a.toggleInfo}
        className={`${iconButton} max-md:hidden ${a.infoOpen ? "text-accent" : "text-fg-muted"}`}
      >
        <PanelRight aria-hidden="true" className="size-5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-header-menu aria-label={ct("chatc.more")} className={iconButton}>
            <MoreVertical aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {common.map(item)}
          {topic.length ? <DropdownMenuSeparator /> : null}
          {topic.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>
      {header.digest === true ? (
        <span ref={summaryHolder} hidden>
          <TopicSummaryButton conversationId={header.id} className="hidden" />
        </span>
      ) : null}
      {state !== "open" ? <PrivacySheet open={privacyOpen} onOpenChange={setPrivacyOpen} state={state} members={sheetPeople} oversightNotice={header.oversightNotice === true} /> : null}
      {header.kind === "TOPIC" && header.me.canModerate ? (
        <TopicSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          topic={settingsTopic}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
            scheduleSync(qc);
          }}
        />
      ) : null}
    </header>
  );
}
