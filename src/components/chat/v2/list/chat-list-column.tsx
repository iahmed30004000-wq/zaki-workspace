"use client";

import React, { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowUpDown, Bookmark, FolderPlus } from "lucide-react";
import { NewDmDialog } from "@/components/chat/home/new-dm-dialog";
import { WorkspaceCreateModal } from "@/components/create-forms";
import { ChatPwaHost } from "@/components/pwa/chat-pwa-host";
import { fetchSpaces, ORGS_QUERY_KEY } from "@/components/shell/space-switcher";
import { ForumView } from "@/components/chat/v2/forum/forum-view";
import type { RowMenuContext } from "@/components/chat/v2/row-menu";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { PhoneListBar } from "@/components/chat/v2/phone/list-bar";
import { useListWidth } from "@/components/chat/v2/use-list-width";
import { isRailWidth } from "@/lib/chat/v2/list-width";
import { useChatList, useChatSpace, useChatUnreadSummary } from "@/lib/chat/cache/selectors";
import { chatKeys } from "@/lib/chat/cache/keys";
import { listQueryOptions } from "@/lib/chat/cache/queries";
import { isSavedRow, type ListWithSaved } from "@/lib/chat/v2/menu/menu-context";
import { openSavedChat } from "@/lib/chat/shortcuts";
import { shortcutBridge } from "@/lib/chat/v2/menu/shortcut-bridge";
import { folderBadge, isCompanyFolder, listRows, normalizeQuery, rowItems, type ListFolderKey } from "@/lib/chat/list-folders";
import { customTabKey, folderBadge as customFolderBadge, folderRows, tabKeyOf, tabsOf, type TabKey } from "@/lib/chat/folders";
import { ct } from "@/lib/chat/text";
import { chatHref, chatRouteOf, forumShown, nextForumSpace, selectedConversationId } from "@/lib/chat/v2/routes";
import { useDayKey } from "@/lib/chat/v2/use-day";
import { useForumHolds } from "@/lib/chat/v2/use-forum";
import { useChatOrders } from "@/lib/chat/v2/use-orders";
import { cn } from "@/lib/utils";
import { CompanyRows } from "./company-rows";
import { useInlineFolders } from "./folder-inline";
import { FolderTabs, useChatPrefs } from "./folder-tabs";
import { nextTab, useFolderSwipe } from "@/lib/chat/v2/folder-swipe";
import { ListHeader } from "./list-header";
import { ListMenu } from "./list-menu";
import { useFolderSourceRows } from "./use-folder-chats";
import { ROW_HEIGHT, ROW_HEIGHT_PHONE } from "./chat-row";
import { ListEmpty, ListError, ListSkeleton } from "./list-states";
import { NewMessageFab } from "./new-message-fab";
import { NewGroupDialog } from "@/components/chat/home/new-group-dialog";
import { NewTopicDialog } from "@/components/chat/home/new-topic-dialog";
import { useSpaceSections } from "@/lib/chat/v2/use-space-sections";
import { VirtualRows } from "./virtual-rows";
import { ArrangeRows } from "./group-arrange";
import { MoveToGroupDialog, NewTopicGroupDialog } from "./group-dialogs";
import { GroupTopicsPane, type GroupPick } from "./group-topics-pane";
import { expandSpaces, groupItems, groupOfRow, type GroupMeta } from "@/lib/chat/v2/groups";
import { useFolderGroupSpaces } from "@/lib/chat/v2/use-folder-groups";
import { useGroupActions, useSpaceGroups } from "@/lib/chat/v2/use-space-groups";
import { useTgPhoneOn } from "@/components/shell/tg-phone";
import { FolderTurn, useFolderTurn, useListScroll } from "@/components/chat/v2/list/tg-list-motion";

/**
 * C2.2 — THE CHAT LIST COLUMN. One component for both shapes of the screen: `column` (the computer: 360 px beside the rail, dragged between 300 and 480,
 * the width kept on this device) and `screen` (the phone: the list IS the screen). It lives in the chat's layout, so it stays mounted while the person
 * moves from `/chat/a` to `/chat/b`; the address decides what it draws inside: the list, or the forum view of one space (`/chat/s/<id>`, C2.3).
 *
 * The list reads ONLY the C1.4 cache (`useChatList`, `useChatUnreadSummary`): the start copy on the device paints it at once, the live feed keeps it
 * current, and each row subscribes to itself. It hard-codes neither shape of D-N2: whatever `GET /api/chat/list` answers (the one list, or the space the
 * person is in) is what is drawn. The server decides every action; nothing here opens a door it would close.
 */
export interface ChatListColumnProps {
  variant: "column" | "screen";
  userId: string;
  /** an external partner: no private chats, no «خاص» folder, no new message */
  guest: boolean;
  /** «اجتماع جديد» (`calls.edit`): the old home's meeting button, kept on the phone's list screen and in the empty pane */
  canMeet: boolean;
  /** the company's switch «قائمة المحادثة» (`chatRowMenu`) */
  rowMenu: boolean;
  /** the owner rank's «حذف نهائي» */
  canPurge: boolean;
  /** «شكل تيليجرام» (`tgLook`; absent: off): the folders as a pill and the main «⋮» menu */
  tgLook?: boolean;
}

export function ChatListColumn(props: ChatListColumnProps) {
  const { variant } = props;
  const pathname = usePathname();
  const route = useMemo(() => chatRouteOf(pathname), [pathname]);
  const { width, columnRef, handle } = useListWidth();
  const column = variant === "column";
  // the forum view stays while one of its topics is open (the topics are the column, the topic is the pane); the list comes back when the person leaves it
  const [forumSpace, setForumSpace] = useState<string | null>(route.kind === "forum" ? route.spaceId : null);
  const holds = useForumHolds(forumSpace, route.kind === "conversation" ? route.id : null);
  useEffect(() => {
    setForumSpace((kept) => nextForumSpace(route, kept, holds));
  }, [route, holds]);
  const forumId = forumShown(route, forumSpace);
  const forum = (spaceId: string) => (
    <ForumView spaceId={spaceId} variant={variant} userId={props.userId} guest={props.guest} rowMenu={props.rowMenu} canPurge={props.canPurge} selectedId={selectedConversationId(route)} />
  );
  return (
    <section
      ref={columnRef}
      aria-label={ct("chatui.list.label")}
      data-chat-list={variant}
      className={cn("relative flex h-full min-h-0 flex-col bg-surface text-fg", column ? "shrink-0" : "w-full")}
      style={column ? { width } : undefined}
    >
      {/* the list stays where it is (its folder, its search, its scroll) while the forum view is drawn over it; it is out of the tab order meanwhile */}
      <div className="flex min-h-0 flex-1 flex-col" aria-hidden={forumId ? true : undefined} {...(forumId ? ({ inert: "" } as Record<string, string>) : {})}>
        <ListScreen {...props} selectedId={selectedConversationId(route)} rail={column && isRailWidth(width)} />
      </div>
      {forumId ? (
        column ? (
          forum(forumId)
        ) : (
          // C2.8: on the phone the frame's top bar (which owned the notch) is hidden on a chat screen, and the forum view's own header has no inset: the view starts below it
          <div data-chat-forum-screen="" className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] z-40">
            {forum(forumId)}
          </div>
        )
      ) : null}
      {column ? (
        <div
          {...handle}
          aria-label={ct("chatui.list.resize")}
          className="absolute inset-y-0 end-0 z-50 w-1.5 cursor-col-resize touch-none hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
        />
      ) : null}
    </section>
  );
}

/**
 * C3a.3 — «الرسائل المحفوظة» BEFORE the chat exists: the server makes it on first use (the dm door, `{ saved: true }`), so until then the list draws one pinned entry that
 * does exactly that. It is drawn only while the cached list says the company's switch is on (`saved`) and holds no saved row; once the chat exists it is an ordinary
 * (pinned) row of the list and this entry is gone.
 */
function SavedEntry({ tall }: { tall: boolean }) {
  const router = useRouter();
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await openSavedChat((id) => {
      void queries.invalidateQueries({ queryKey: chatKeys.list() });
      router.push(chatHref.conversation(id));
    });
    setBusy(false);
    setFailed(!ok);
  };
  return (
    <button
      type="button"
      data-saved-entry=""
      disabled={busy}
      onClick={() => void open()}
      style={{ height: tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT }}
      className="flex w-full shrink-0 items-center gap-3 border-b border-border/60 px-3 text-start hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
    >
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-accent text-accent-fg", tall ? "size-14" : "size-12")}>
        <Bookmark className="size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-medium">{ct("chatsaved.title")}</span>
        <span className={cn("truncate text-sm", failed ? "text-danger" : "text-fg-muted")}>{ct(failed ? "chatsaved.open_failed" : "chatsaved.entry_hint")}</span>
      </span>
    </button>
  );
}

/** «المحادثات المؤرشفة»: one row on top of the list (Telegram's), the person's OWN archive (C3a.1); it opens the archive folder. */
function ArchivedEntry({ tall, count, onOpen, names }: { tall: boolean; count: number; onOpen: () => void; /** «تيليجرام»: the newest archived chats, on a second line */ names?: string }) {
  return (
    <button
      type="button"
      data-archived-entry=""
      onClick={onOpen}
      style={{ height: tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT }}
      className="flex w-full shrink-0 items-center gap-3 border-b border-border/60 px-3 text-start hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted", tall ? "size-14" : "size-12")}>
        <Archive className="size-6" />
      </span>
      {names ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{ct("chatui.list.archived_entry")}</span>
          <bdi data-archived-names="" className="truncate text-sm text-fg-muted">{names}</bdi>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-base font-medium">{ct("chatui.list.archived_entry")}</span>
      )}
      <span className="grid min-w-6 shrink-0 place-items-center rounded-full bg-fg-muted/20 px-1.5 text-xs font-semibold text-fg-muted">{count}</span>
    </button>
  );
}

/** The conversations list with its folders and search: every conversation the server put in the list, in the folder asked for. */
const ListScreen = memo(function ListScreen({ variant, userId, guest, canMeet, rowMenu, canPurge, tgLook, selectedId, rail }: ChatListColumnProps & { selectedId: string | null; rail: boolean }) {
  const tall = variant === "screen";
  const searchId = useId();
  const day = useDayKey();
  const list = useChatList("all");
  // C3a.3: the company's switch for «الرسائل المحفوظة», as the cached list says it (it only reads the cache)
  const savedOn = useQuery({ ...listQueryOptions(), select: (d: ListWithSaved) => d.saved === true, enabled: false }).data === true;
  const hasSaved = list.rows.some((row) => isSavedRow(row, userId));
  const summary = useChatUnreadSummary();
  const orders = useChatOrders(!guest);
  const [folderKey, setFolderKey] = useState<TabKey>("all");
  // C3a.2: the person's own folders and the built-in tabs they hid (nothing of either until the prefs have come, or while the company's switch is off)
  const prefs = useChatPrefs();
  // S5.3: the «+» at the end of the strip, the long press on a tab, and the sheets they open
  const inline = useInlineFolders();
  // S5.3: the rows the person's own folders are drawn from: the list, plus (one-list shape) the topics of the current space that a folder lists by hand
  const folderSource = useFolderSourceRows(list, prefs.folders);
  const [query, setQuery] = useState("");
  const [newDm, setNewDm] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [newTopic, setNewTopic] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);

  // C3a.1: «الأرشيف» is offered only while the switch is on AND the person has a chat they archived (the server sends none as archived while it is off)
  const archived = list.personal && list.archivedRows.length > 0;
  const folders = useMemo(() => tabsOf({ canOversee: list.canOversee, guest, archived, folders: prefs.folders, hidden: prefs.hidden, oneSpace: list.scope === "space" }), [list.canOversee, guest, archived, prefs.folders, prefs.hidden, list.scope]);
  const folder = tabKeyOf(folderKey, folders);
  // one of the person's own folders (its definition), or none: the tabs are the built-in ones plus theirs, and `folder` is the key of one of them
  const custom = useMemo(() => prefs.folders.find((f) => customTabKey(f.id) === folder) ?? null, [prefs.folders, folder]);
  const builtin = custom ? null : (folder as ListFolderKey);
  const company = builtin !== null && isCompanyFolder(builtin);
  const words = normalizeQuery(query);

  const rows = useMemo(() => {
    if (custom) return folderRows(folderSource, custom, { scope: list.scope, spaceId: list.spaceId }, { query: words, orders });
    if (builtin === null || isCompanyFolder(builtin)) return [];
    return listRows(builtin === "archived" ? list.archivedRows : list.rows, { scope: list.scope, spaceId: list.spaceId, folder: builtin, query: words, orders });
  }, [list.rows, list.archivedRows, list.scope, list.spaceId, custom, builtin, words, orders, folderSource]);
  const items = useMemo(() => rowItems(rows), [rows]);

  // a finger across the list goes to the next or the previous folder (`src/lib/chat/v2/folder-swipe.ts`); the click on a tab does the same
  // «تيليجرام»: another folder slides in from its side (the stylesheet), and scrolling down puts the search pill and the round button away
  const tg = useTgPhoneOn() && tall;
  const turn = useFolderTurn(folders.findIndex((f) => f.key === folder), tg);
  const scroll = useListScroll(tg, folder);
  const swipe = useFolderSwipe((way) => {
    const target = nextTab(folders, folder, way);
    if (target) setFolderKey(target.key);
  }, tall || !rail);

  // C2.6: the keyboard (Alt+↑/↓, Alt+Shift+↑/↓, Ctrl+1…9) reads the rows in the order they are drawn and the folders of THIS list. A space row is not a
  // conversation, so it is not a chat to step to. The source is registered once and always answers from the latest rows.
  const live = useRef({ entries: [] as { id: string; unread: boolean }[], folders });
  live.current = { entries: rows.filter((row) => row.kind !== "SPACE").map((row) => ({ id: row.id, unread: row.unread > 0 || row.markedUnread })), folders };
  useEffect(
    () =>
      shortcutBridge.setList({
        entries: () => live.current.entries,
        folderCount: () => live.current.folders.length,
        selectFolder: (index) => {
          const target = live.current.folders[index];
          if (target) setFolderKey(target.key);
        },
      }),
    [],
  );
  const badges = useMemo(
    () =>
      Object.fromEntries(
        folders.map((f) => {
          const def = prefs.folders.find((x) => customTabKey(x.id) === f.key);
          return [f.key, def ? customFolderBadge(folderSource, def) : folderBadge(summary, f.key as ListFolderKey)];
        }),
      ) as Partial<Record<TabKey, number>>,
    [folders, summary, prefs.folders, folderSource],
  );

  // the list of ONE space (D-N2 «كل مساحة حساب»): its topics have no manager flag of their own, so the space's own view says whether the viewer manages it
  const oneSpace = useChatSpace(list.scope === "space" ? list.spaceId : null);

  // «مجموعات المواضيع»: inside ONE space the topics are drawn as one row per group (and «عام»); a tap opens the group's topics over the list. With no group, a search, the archive or the
  // company's screen, the list is exactly what it was. The managers get «مجموعة جديدة» and «ترتيب» on a thin bar above the rows.
  const groupSpaceId = list.scope === "space" ? list.spaceId : null;
  const { groups } = useSpaceGroups(groupSpaceId);
  const canManageGroups = oneSpace.space?.canModerate === true && !guest;
  const groupable = groupSpaceId !== null && !words && !company && builtin !== "archived";
  const groupMode = groupable && groups.length > 0;
  const generalName = ct("chatgrp.general");
  const [topicGroup, setTopicGroup] = useState<GroupPick | null>(null);
  const [arrangingGroups, setArrangingGroups] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [moving, setMoving] = useState<ChatRowDto | null>(null);
  const groupActions = useGroupActions(groupSpaceId);
  // «مجلد ← مجموعة ← موضوع»: in a folder of the person's own, a space that has groups is drawn as its groups (the one list's shape, where the list holds the space as ONE row)
  const expandIds = useMemo(() => (custom && list.scope === "all" && !words ? custom.include.spaceIds.filter((id) => rows.some((r) => r.kind === "SPACE" && r.id === id)) : []), [custom, list.scope, words, rows]);
  const expanded = useFolderGroupSpaces(expandIds, expandIds.length > 0);
  const shownItems = useMemo(
    () => (groupMode ? groupItems(rows, groups, generalName, { showEmpty: canManageGroups }) : expanded.size > 0 ? expandSpaces(rows, expanded, generalName) : items),
    [groupMode, rows, groups, generalName, canManageGroups, items, expanded],
  );
  const menu = useMemo<RowMenuContext>(
    () => ({
      enabled: rowMenu,
      canPurge,
      canModerate: oneSpace.space?.canModerate === true,
      personal: list.personal,
      ...((groupMode && canManageGroups) || [...expanded.values()].some((s) => s.canManage) ? { onMoveToGroup: (row: ChatRowDto) => setMoving(row) } : {}),
    }),
    [rowMenu, canPurge, oneSpace.space?.canModerate, list.personal, groupMode, canManageGroups, expanded],
  );
  const onOpenGroup = (model: { id: string | null; name: string; emoji: string | null; spaceId?: string }) =>
    setTopicGroup({ ...(model.spaceId ? { spaceId: model.spaceId } : {}), id: model.id, name: model.name, emoji: model.emoji });
  // what the open group's pane reads: the space's own list, or the space a folder holds
  const paneSpace: { id: string; rows: readonly ChatRowDto[]; groups: readonly GroupMeta[]; canManage: boolean } | null = topicGroup?.spaceId
    ? (() => {
        const known = expanded.get(topicGroup.spaceId);
        return known ? { id: topicGroup.spaceId, rows: known.topics, groups: known.groups, canManage: known.canManage } : null;
      })()
    : groupSpaceId && groupMode
      ? { id: groupSpaceId, rows: list.rows, groups, canManage: canManageGroups }
      : null;
  const movingSpace = moving ? (moving.space?.id && expanded.has(moving.space.id) ? { id: moving.space.id, groups: expanded.get(moving.space.id)!.groups } : groupSpaceId ? { id: groupSpaceId, groups } : null) : null;
  // the group stays open only while the list is grouped; and (on the computer) the topic that is open keeps its group on screen
  useEffect(() => {
    if (!groupMode) {
      // the group a FOLDER opened (it names its space) lives on while that space's groups are known
      setTopicGroup((open) => (open?.spaceId ? open : null));
      setArrangingGroups(false);
    }
  }, [groupMode]);
  useEffect(() => {
    if (tall || !groupMode || !selectedId || topicGroup) return;
    const row = list.rows.find((r) => r.id === selectedId && r.kind === "TOPIC");
    const place = row ? groupOfRow(row, groups) : undefined;
    const meta = place ? groups.find((g) => g.id === place) : undefined;
    if (row && place === null) setTopicGroup({ id: null, name: generalName, emoji: null });
    else if (meta) setTopicGroup({ id: meta.id, name: meta.name, emoji: meta.emoji });
    // only when the open topic (or the mode) changes: a group the person closed by hand is not opened again by a new message
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, groupMode]);

  // «موضوع جديد» (the owner, 2026-11-21): in the list of ONE space, for whoever may open a topic there (the server decides again); the dialog opens once the space's sections are in
  const topicSpaceId = list.scope === "space" && !guest && oneSpace.space?.canCreateTopic === true ? list.spaceId : null;
  const sections = useSpaceSections(topicSpaceId ?? "", newTopic);
  const openTopic = topicSpaceId ? () => setNewTopic(true) : undefined;
  const openGroup = guest ? undefined : () => setNewGroup(true);

  // «افتح مساحة» only for whoever may open one and only when there is nothing at all in the list (the old home's rule, the shell's own query)
  const empty = !list.isPending && list.rows.length === 0;
  const spaces = useQuery({ queryKey: ORGS_QUERY_KEY, queryFn: fetchSpaces, staleTime: 60_000, enabled: !guest && empty });
  const orgs = spaces.data?.organizations ?? [];
  const canCreateSpace = !guest && orgs.some((org) => org.canCreateSpaces);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...swipe} {...(tg ? { onScrollCapture: scroll.onScroll, ...(scroll.down ? { "data-tg-scrolled": "" } : {}) } : {})}>
      {tall ? (
        // C2.8: the phone's screen has its own 56 px bar: «☰» (only with the new menu), the folder's name or «زاكي», and a search that expands
        <PhoneListBar title={custom ? custom.name : ct(folder === "all" ? "chatui.phone.title" : (folders.find((f) => f.key === folder)?.labelKey ?? "chatui.phone.title"))} query={query} onQuery={setQuery} searchId={searchId} scrolled={scroll.down} {...(tgLook === true ? { menu: <ListMenu guest={guest} {...(openGroup ? { onNewGroup: openGroup } : {})} /> } : {})} />
      ) : rail ? null : (
        <ListHeader query={query} onQuery={setQuery} searchId={searchId} {...(tgLook === true ? { menu: <ListMenu guest={guest} {...(openGroup ? { onNewGroup: openGroup } : {})} /> } : {})} {...(guest ? {} : { onNewMessage: () => setNewDm(true), onNewGroup: openGroup, onNewTopic: openTopic })} />
      )}
      {/* the owner (item 7): the folders are ONE strip of tabs above the list, on the phone and on the computer alike (the column beside the list is gone); folded to a rail there is no room for it */}
      {rail ? null : <FolderTabs folders={folders} active={folder} badges={badges} onChange={setFolderKey} pill={tgLook === true} {...inline.tabProps} />}
      {/* M1a: the installed app's pieces: «فعّل الإشعارات لتوصلك الرسائل والجهاز مسكّر» (only while a question can still be answered), the service worker, `?new=message` */}
      {rail ? null : <ChatPwaHost guest={guest} />}
      {/* the owner (2026-11-22), like Telegram: «المحادثات المؤرشفة» at the top of the list, with how many; a press opens the archive */}
      {archived && !rail && !words && folder === "all" && !list.isPending ? <ArchivedEntry tall={tall} count={list.archivedRows.length} onOpen={() => setFolderKey("archived")} {...(tg ? { names: list.archivedRows.slice(0, 3).map((r) => r.title).join("\u060C ") } : {})} /> : null}
      {/* C3a.3: «المحفوظة» before it exists: one pinned entry on top of the list (the folder «الكل», no search) */}
      {savedOn && !hasSaved && !company && !words && folder === "all" && !list.isPending ? <SavedEntry tall={tall} /> : null}
      {/* a refresh that failed while the list shows what it already holds (the start copy, or the last good answer): said, with the way to try again */}
      {!company && list.isError && list.rows.length > 0 ? <ListError onRetry={() => void list.refetch()} /> : null}
      {groupable && canManageGroups && !rail ? (
        <div data-groups-toolbar="" className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1">
          <button
            type="button"
            data-new-group-button=""
            onClick={() => setNewGroupOpen(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            {ct("chatgrp.new")}
          </button>
          {groupMode && groups.length > 1 ? (
            <button
              type="button"
              data-groups-arrange=""
              aria-pressed={arrangingGroups}
              onClick={() => setArrangingGroups((on) => !on)}
              className={cn("ms-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", arrangingGroups ? "bg-accent/15 text-accent" : "text-fg-muted hover:text-fg")}
            >
              <ArrowUpDown className="size-4" aria-hidden="true" />
              {ct(arrangingGroups ? "chatgrp.arrange_done" : "chatgrp.arrange")}
            </button>
          ) : null}
        </div>
      ) : null}

      {company ? (
        <CompanyRows selectedId={selectedId} />
      ) : list.isPending && list.rows.length === 0 ? (
        <ListSkeleton tall={tall} />
      ) : list.isError && list.rows.length === 0 ? (
        <ListError onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty folder={custom ? "custom" : (folder as ListFolderKey)} query={words} {...(canCreateSpace && folder === "all" && !words ? { onCreateSpace: () => setCreatingSpace(true) } : {})} />
      ) : arrangingGroups && groupMode ? (
        <ArrangeRows listId={`groups-${groupSpaceId}`} entries={groups.map((g) => ({ id: g.id, label: g.name, emoji: g.emoji, imageUrl: g.imageUrl ?? null }))} onReorder={(ids) => groupActions.reorder.mutate(ids)} />
      ) : (
        <FolderTurn on={tg} folder={folder} way={turn}>
          <VirtualRows items={shownItems} tall={tall} rail={rail} selectedId={selectedId} userId={userId} menu={menu} label={ct("chatui.list.rows")} day={day} onOpenGroup={onOpenGroup} />
        </FolderTurn>
      )}

      {!guest && tall ? <NewMessageFab onClick={() => setNewDm(true)} onGroup={openGroup} onTopic={openTopic} canMeet={canMeet} /> : null}
      {!guest ? <NewDmDialog open={newDm} onOpenChange={setNewDm} /> : null}
      {!guest ? <NewGroupDialog open={newGroup} onOpenChange={setNewGroup} /> : null}
      {topicSpaceId && oneSpace.space && newTopic && sections.settled ? <NewTopicDialog open onOpenChange={setNewTopic} space={{ id: topicSpaceId, name: oneSpace.space.name, sections: sections.sections }} /> : null}
      {inline.element}
      {topicGroup && paneSpace ? (
        <GroupTopicsPane spaceId={paneSpace.id} group={topicGroup} rows={paneSpace.rows} groups={paneSpace.groups} orders={orders} canManage={paneSpace.canManage} variant={variant} userId={userId} menu={menu} selectedId={selectedId} onBack={() => setTopicGroup(null)} onEdited={(next) => setTopicGroup((open) => (open ? { ...open, ...next } : open))} />
      ) : null}
      {groupSpaceId && newGroupOpen ? <NewTopicGroupDialog spaceId={groupSpaceId} onClose={() => setNewGroupOpen(false)} /> : null}
      {moving && movingSpace ? <MoveToGroupDialog row={moving} spaceId={movingSpace.id} groups={movingSpace.groups} current={groupOfRow(moving, movingSpace.groups)} onClose={() => setMoving(null)} /> : null}
      {canCreateSpace ? <WorkspaceCreateModal open={creatingSpace} onClose={() => setCreatingSpace(false)} organizations={orgs.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))} /> : null}
      </div>
    </div>
  );
});
