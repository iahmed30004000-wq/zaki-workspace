"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { NewDmDialog } from "@/components/chat/home/new-dm-dialog";
import { MeetingButton } from "@/components/calls/meeting-button";
import { WorkspaceCreateModal } from "@/components/create-forms";
import { fetchSpaces, ORGS_QUERY_KEY } from "@/components/shell/space-switcher";
import { ForumView } from "@/components/chat/v2/forum/forum-view";
import type { RowMenuContext } from "@/components/chat/v2/row-menu";
import { useListWidth } from "@/components/chat/v2/use-list-width";
import { useChatList, useChatSpace, useChatUnreadSummary } from "@/lib/chat/cache/selectors";
import { foldersOf, folderBadge, folderKeyOf, isCompanyFolder, listRows, normalizeQuery, rowItems, type ListFolderKey } from "@/lib/chat/list-folders";
import { ct } from "@/lib/chat/text";
import { chatRouteOf, forumShown, nextForumSpace, selectedConversationId } from "@/lib/chat/v2/routes";
import { useChatOrders } from "@/lib/chat/v2/use-orders";
import { cn } from "@/lib/utils";
import { CompanyRows } from "./company-rows";
import { FolderTabs } from "./folder-tabs";
import { ListHeader } from "./list-header";
import { ListEmpty, ListError, ListSkeleton } from "./list-states";
import { NewMessageFab } from "./new-message-fab";
import { VirtualRows } from "./virtual-rows";

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
}

export function ChatListColumn(props: ChatListColumnProps) {
  const { variant } = props;
  const pathname = usePathname();
  const route = useMemo(() => chatRouteOf(pathname), [pathname]);
  const { width, columnRef, handle } = useListWidth();
  const column = variant === "column";
  // the forum view stays while one of its topics is open (the topics are the column, the topic is the pane); the list comes back when the person leaves it
  const [forumSpace, setForumSpace] = useState<string | null>(route.kind === "forum" ? route.spaceId : null);
  const forumTopics = useChatSpace(forumSpace).rows;
  useEffect(() => {
    setForumSpace((kept) => nextForumSpace(route, kept, forumTopics.map((row) => row.id)));
  }, [route, forumTopics]);
  const forumId = forumShown(route, forumSpace);
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
        <ListScreen {...props} selectedId={selectedConversationId(route)} />
      </div>
      {forumId ? <ForumView spaceId={forumId} variant={variant} userId={props.userId} guest={props.guest} rowMenu={props.rowMenu} canPurge={props.canPurge} selectedId={selectedConversationId(route)} /> : null}
      {column ? (
        <div
          {...handle}
          aria-label={ct("chatui.list.resize")}
          className="absolute inset-y-0 end-0 z-30 w-1.5 cursor-col-resize touch-none hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
        />
      ) : null}
    </section>
  );
}

/** The conversations list with its folders and search: every conversation the server put in the list, in the folder asked for. */
function ListScreen({ variant, userId, guest, canMeet, rowMenu, canPurge, selectedId }: ChatListColumnProps & { selectedId: string | null }) {
  const tall = variant === "screen";
  const searchId = useId();
  const list = useChatList("all");
  const summary = useChatUnreadSummary();
  const orders = useChatOrders(!guest);
  const [folderKey, setFolderKey] = useState<ListFolderKey>("all");
  const [query, setQuery] = useState("");
  const [newDm, setNewDm] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);

  const folders = useMemo(() => foldersOf({ canOversee: list.canOversee, guest }), [list.canOversee, guest]);
  const folder = folderKeyOf(folderKey, folders);
  const company = isCompanyFolder(folder);
  const words = normalizeQuery(query);

  const rows = useMemo(
    () => (isCompanyFolder(folder) ? [] : listRows(list.rows, { scope: list.scope, spaceId: list.spaceId, folder, query: words, orders })),
    [list.rows, list.scope, list.spaceId, folder, words, orders],
  );
  const items = useMemo(() => rowItems(rows), [rows]);
  const badges = useMemo(() => Object.fromEntries(folders.map((f) => [f.key, folderBadge(summary, f.key)])) as Partial<Record<ListFolderKey, number>>, [folders, summary]);

  // the list of ONE space (D-N2 «كل مساحة حساب»): its topics have no manager flag of their own, so the space's own view says whether the viewer manages it
  const oneSpace = useChatSpace(list.scope === "space" ? list.spaceId : null);
  const menu = useMemo<RowMenuContext>(() => ({ enabled: rowMenu, canPurge, canModerate: oneSpace.space?.canModerate === true }), [rowMenu, canPurge, oneSpace.space?.canModerate]);

  // «افتح مساحة» only for whoever may open one and only when there is nothing at all in the list (the old home's rule, the shell's own query)
  const empty = !list.isPending && list.rows.length === 0;
  const spaces = useQuery({ queryKey: ORGS_QUERY_KEY, queryFn: fetchSpaces, staleTime: 60_000, enabled: !guest && empty });
  const orgs = spaces.data?.organizations ?? [];
  const canCreateSpace = !guest && orgs.some((org) => org.canCreateSpaces);

  return (
    <>
      <ListHeader query={query} onQuery={setQuery} searchId={searchId} {...(guest ? {} : { onNewMessage: () => setNewDm(true) })} />
      <FolderTabs folders={folders} active={folder} badges={badges} onChange={setFolderKey} />
      {canMeet && tall ? (
        <div className="shrink-0 border-b border-border/60 px-3 py-2">
          <MeetingButton />
        </div>
      ) : null}

      {company ? (
        <CompanyRows selectedId={selectedId} />
      ) : list.isPending && list.rows.length === 0 ? (
        <ListSkeleton tall={tall} />
      ) : list.isError && list.rows.length === 0 ? (
        <ListError onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty folder={folder} query={words} {...(canCreateSpace && folder === "all" && !words ? { onCreateSpace: () => setCreatingSpace(true) } : {})} />
      ) : (
        <VirtualRows items={items} tall={tall} selectedId={selectedId} userId={userId} menu={menu} label={ct("chatui.list.rows")} />
      )}

      {!guest && tall ? <NewMessageFab onClick={() => setNewDm(true)} /> : null}
      {!guest ? <NewDmDialog open={newDm} onOpenChange={setNewDm} /> : null}
      {canCreateSpace ? <WorkspaceCreateModal open={creatingSpace} onClose={() => setCreatingSpace(false)} organizations={orgs.map((org) => ({ id: org.id, name: org.name, canAdmin: org.canCreateSpaces }))} /> : null}
    </>
  );
}
