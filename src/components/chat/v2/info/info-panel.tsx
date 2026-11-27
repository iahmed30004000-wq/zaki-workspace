"use client";

import React from "react";
import Link from "next/link";
import { Bookmark, Phone, Search, UserPlus, X } from "lucide-react";
import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { InfoTabs } from "@/components/chat/v2/info/info-tabs";
import { MuteRow } from "@/components/chat/v2/info/info-mute";
import { InfoMenu } from "@/components/chat/v2/info/info-menu";
import { InfoActions } from "@/components/chat/v2/info/info-actions";
import { TopicSoundRow } from "@/components/chat/v2/info/info-sound";
import { CallButton } from "@/components/calls/call-button";
import { TopicSettingsDialog } from "@/components/chat/conversation/topic-settings-dialog";
import { useChatRow } from "@/lib/chat/cache/selectors";
import { ct } from "@/lib/chat/text";
import { infoModelOf } from "@/lib/chat/v2/info/info-model";
import { isSavedHeader, isSavedRow } from "@/lib/chat/v2/menu/menu-context";
import { usePeerProfile, useTeamName } from "@/lib/chat/v2/info/use-info-data";
import { composerDetailOf, type PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { ProfileQrRow } from "./profile-qr";

const card = "mt-2 bg-surface-1 px-4 py-3";
const row = "inline-flex min-h-11 w-full items-center rounded-lg px-3 text-start text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const pill = "inline-flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl bg-surface-1 px-2 text-xs font-semibold text-accent shadow-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

function Names({ names }: { names: MemberDto[] }) {
  return (
    <ul data-info-names className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {names.map((m) => (
        <li key={m.id} className="flex min-h-11 items-center gap-3 px-3">
          <Avatar name={m.name} src={m.avatarUrl} className="size-7 text-xs" />
          <bdi className="min-w-0 flex-1 truncate">{m.name}</bdi>
          {m.verified ? <VerifiedBadge /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * C2.7 — THE INFO PANEL (a private chat or a topic), ONE component for every place it is drawn: the 360 px column beside the conversation on a computer, the
 * overlay sheet on a tablet (both through `seams/info-host.tsx`) and C2.8's phone route `/chat/[id]/info`. It imports nothing of the pane's provider: what
 * it can DO is handed in, so the route can hand in its own.
 *
 *   the big picture · the title · the line under it
 *   «🔍 بحث» and «📞 اتصال» (only where the person may call; «🔔 الإشعارات» has no per-person door before C3a and is NOT drawn)
 *   a private chat: the job title and the bio (the profile door; nothing when it refuses) and «افتح الملف الشخصي»
 *   a topic: the space, who sees it (P0.4: a private topic says so WITHOUT names unless the door gave them) and, for its moderators, «إعدادات الموضوع», close, archive
 *
 * C3d + S5.4: «كتم الإشعارات» (`MuteRow`, the chat list's own presets), then the tabs «الوسائط · الملفات · الروابط · الصوتيات · الأعضاء» — always drawn, each with an empty
 * sentence — and «الشغل · المثبّتة» when they have data (`InfoTabs`). The server decides every action again.
 */
export interface InfoPanelProps {
  header: ConversationHeaderDto;
  /** the people the existing door gave (the pane asks for them once per conversation) */
  people: PaneMembers | null;
  /** «🔍 بحث» */
  onSearch: () => void;
  /** a topic change through the topics door (close, reopen, archive, bring back) */
  onTopic: (patch: { closed?: boolean; archived?: boolean }) => void;
  /** a settings change was saved: the header is asked for again */
  onSettingsSaved?: () => void;
  /** docked: the panel draws its own header with a close button (the sheet has its own title and corner button) */
  onClose?: () => void;
  /** the phone's info page with «تيليجرام على التلفون»: a bigger picture, the action cards, «إضافة أعضاء», and the phone's tabs */
  phone?: boolean;
  /** «مراسلة» (the phone's cards): back to the conversation */
  onMessage?: () => void;
  /** the active tab's line for the page's bar («85 رابطًا»), or null while it is not known */
  onCounter?: (line: string | null) => void;
}

export function InfoPanel({ header, people, onSearch, onTopic, onSettingsSaved, onClose, phone = false, onMessage, onCounter }: InfoPanelProps) {
  const listed = useChatRow(header.id);
  const system = listed?.system === true;
  const teamName = useTeamName(header.id, header.space?.id ?? null, header.teamId ?? null);
  const model = infoModelOf(header, { people, teamName, system });
  const profile = usePeerProfile(header.id, model.peerId);
  // S6.4 «شكل تيليجرام»: rounded inset cards, three equal tiles, the «⋮» corner menu (the company's switch `tgLook`; absent: on)
  const tg = header.tgLook !== false;
  const cardClass = tg ? "mx-3 mt-2 rounded-2xl bg-surface-1 px-4 py-3 shadow-card" : card;
  // C3a.3: «الرسائل المحفوظة» — a chat with myself: a bookmark for a picture, no call (nobody to ring), no profile, and ONE line that says the owner's rule honestly
  // the list's row says it by the chat's KEY (its other person is me); the header's own look is only for a header opened before the list is in the cache
  const saved = listed ? isSavedRow(listed, header.me.id) : isSavedHeader(header);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // ONE object per header and people (the settings dialog resets its fields whenever the topic it was given changes)
  const settingsTopic = React.useMemo(() => composerDetailOf(header, people), [header, people]);

  return (
    <div data-info-panel className="flex h-full min-h-0 flex-1 flex-col bg-surface-2 text-fg">
      {onClose ? (
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-1 px-3">
          <h2 className="font-semibold">{ct("chatui.pane.menu.info")}</h2>
          <button type="button" data-info-close aria-label={ct("chatui.info.close")} onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-2">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section data-info-hero className={phone ? "relative flex flex-col items-center gap-1 px-4 pb-4 pt-3 text-center" : "relative flex flex-col items-center gap-1 px-4 pb-3 pt-6 text-center"}>
          {tg && model.kind === "dm" && !saved && model.peerId ? <InfoMenu userId={model.peerId} name={header.title} onSearch={onSearch} /> : null}
          {saved ? (
            <span aria-hidden="true" data-info-saved-avatar className={`grid place-items-center rounded-full bg-accent text-accent-fg ${phone ? "size-28" : "size-24"}`}>
              <Bookmark className="size-12" />
            </span>
          ) : model.avatar.kind === "person" ? (
            <Avatar name={model.avatar.name} src={model.avatar.src} className={phone ? "size-28 text-4xl" : "size-24 text-3xl"} />
          ) : (
            <span aria-hidden="true" className={phone ? "grid size-28 place-items-center rounded-full bg-surface-1 text-6xl shadow-card" : "grid size-24 place-items-center rounded-full bg-surface-2 text-5xl"}>
              {model.avatar.emoji}
            </span>
          )}
          <h3 className={`mt-2 flex max-w-full items-center justify-center gap-1.5 break-words font-semibold ${phone ? "text-xl" : "text-lg"}`}>
            <span className="min-w-0 break-words">{model.title}</span>
            {/* S5.5: «موثّق» next to the other person's name in a private chat */}
            {model.kind === "dm" && !saved && header.peer?.verified ? <VerifiedBadge /> : null}
          </h3>
          {model.subtitle && !saved ? <p className="max-w-full break-words text-sm text-fg-muted">{model.subtitle}</p> : null}
        </section>

        {phone ? (
          <InfoActions header={header} people={people} model={model} saved={saved} onMessage={onMessage ?? onSearch} onSearch={onSearch} />
        ) : (
          <>
            <div className={`grid ${tg ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"} gap-2 px-4 pb-3`}>
              <button type="button" data-info-button="search" onClick={onSearch} className={pill}>
                <Search aria-hidden="true" className="size-6" />
                {ct("chatui.info.search")}
              </button>
              {model.buttons.includes("call") && !saved ? <CallButton conversationId={header.id} isDm={header.kind === "DM"} canStart outlined /> : null}
            </div>

            <MuteRow header={header} saved={saved} tg={tg} />
          </>
        )}
        {/* S5.1: «صوت هالموضوع»: كل الرسائل / الذكر بس (this device; only while the company's switch `chatSounds` is on) */}
        <TopicSoundRow header={header} saved={saved} />

        <div className={`space-y-3 ${cardClass}`}>
          {model.kind === "dm" && profile ? (
            <div data-info-profile className="space-y-2 text-sm">
              {profile.jobTitle ? (
                <p>
                  <span className="block text-xs text-fg-muted">{ct("chatui.info.job")}</span>
                  <bdi>{profile.jobTitle}</bdi>
                </p>
              ) : null}
              {profile.bio ? (
                <p>
                  <span className="block text-xs text-fg-muted">{ct("chatui.info.bio")}</span>
                  <bdi className="whitespace-pre-wrap">{profile.bio}</bdi>
                </p>
              ) : null}
              {model.peerId && header.tgLook !== false ? <ProfileQrRow userId={model.peerId} name={header.title} className={`${row} text-accent`} /> : null}
              {model.peerId ? (
                <Link href={`/u/${encodeURIComponent(model.peerId)}`} data-info-open-profile className={`${row} text-accent`}>
                  {ct("chatui.info.open_profile")}
                </Link>
              ) : null}
            </div>
          ) : null}

          {saved && header.oversightNotice !== false ? (
            <p data-info-saved-oversight className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
              {ct("chatsaved.info.oversight")}
            </p>
          ) : null}

          {model.space ? (
            <p className="text-sm">
              <span className="block text-xs text-fg-muted">{ct("chatui.info.space")}</span>
              <bdi>{model.space}</bdi>
            </p>
          ) : null}

          {model.audience ? (
            <div data-info-audience={model.audience.state} className="text-sm">
              <span className="block text-xs text-fg-muted">{ct("chatui.info.audience")}</span>
              <p>{model.audience.line}</p>
              {model.audience.names.length > 0 ? <Names names={model.audience.names} /> : null}
              {model.oversightNotice ? <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 p-3">⚠️ {ct("chatp.sheet.oversight")}</p> : null}
            </div>
          ) : null}
        </div>

        {model.moderator.length > 0 ? (
          <div className="mt-2 space-y-1 bg-surface-1 px-2 py-2">
            {model.moderator.map((id) =>
              id === "settings" ? (
                <button key={id} type="button" data-info-moderator={id} onClick={() => setSettingsOpen(true)} className={row}>
                  {ct("chatc.topic.settings")}
                </button>
              ) : id === "close" ? (
                <button key={id} type="button" data-info-moderator={id} onClick={() => onTopic({ closed: true })} className={row}>
                  {ct("chatc.topic.close")}
                </button>
              ) : id === "reopen" ? (
                <button key={id} type="button" data-info-moderator={id} onClick={() => onTopic({ closed: false })} className={row}>
                  {ct("chatc.topic.reopen")}
                </button>
              ) : id === "archive" ? (
                <button key={id} type="button" data-info-moderator={id} onClick={() => onTopic({ archived: true })} className={row}>
                  {ct("chatc.topic.archive")}
                </button>
              ) : id === "unarchive" ? (
                <button key={id} type="button" data-info-moderator={id} onClick={() => onTopic({ archived: false })} className={row}>
                  {ct("chatc.topic.unarchive")}
                </button>
              ) : null,
            )}
          </div>
        ) : null}
        {/* a topic made for named people: its moderators add them in the topic's settings (an open topic's people are its space's) */}
        {phone && header.kind === "TOPIC" && header.restricted === true && model.moderator.includes("settings") ? (
          <button type="button" data-info-add-members="" onClick={() => setSettingsOpen(true)} className="mx-3 mt-3 flex min-h-14 w-[calc(100%-1.5rem)] items-center gap-3 rounded-2xl bg-surface-1 px-4 text-start text-[15px] text-fg shadow-card">
            <UserPlus aria-hidden="true" className="size-5 shrink-0 text-accent" />
            {ct("tgsheets.info.add_members")}
          </button>
        ) : null}
        {phone ? <InfoTabs header={header} people={people} phone {...(onCounter ? { onCounter } : {})} /> : <InfoTabs header={header} people={people} />}
      </div>
      {header.kind === "TOPIC" && header.me.canModerate ? <TopicSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} topic={settingsTopic} onSaved={() => onSettingsSaved?.()} /> : null}
    </div>
  );
}
