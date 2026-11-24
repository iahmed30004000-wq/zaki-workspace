"use client";

import React, { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpDown, FolderPlus, Plus } from "lucide-react";
import { NewTopicDialog } from "@/components/chat/home/new-topic-dialog";
import { ListHeader } from "@/components/chat/v2/list/list-header";
import { ListEmpty, ListError, ListSkeleton } from "@/components/chat/v2/list/list-states";
import { VirtualRows } from "@/components/chat/v2/list/virtual-rows";
import { ArrangeRows } from "@/components/chat/v2/list/group-arrange";
import { MoveToGroupDialog, NewTopicGroupDialog } from "@/components/chat/v2/list/group-dialogs";
import { GroupTopicsPane, type GroupPick } from "@/components/chat/v2/list/group-topics-pane";
import type { RowMenuContext } from "@/components/chat/v2/row-menu";
import { useChatSpace } from "@/lib/chat/cache/selectors";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { groupedForumItems, groupOfRow } from "@/lib/chat/v2/groups";
import { useGroupActions, useSpaceGroups } from "@/lib/chat/v2/use-space-groups";
import { cn } from "@/lib/utils";
import { forumItems, forumRows, normalizeQuery } from "@/lib/chat/list-folders";
import { ct, ctCount } from "@/lib/chat/text";
import { chatHref } from "@/lib/chat/v2/routes";
import { useDayKey } from "@/lib/chat/v2/use-day";
import { useChatOrders } from "@/lib/chat/v2/use-orders";
import { useSpaceSections } from "@/lib/chat/v2/use-space-sections";

/**
 * C2.3 — THE FORUM VIEW of one space (`/chat/s/<spaceId>`): the space is a forum and its topics are the rows. It opens INSIDE the list column, over the
 * list, with a back arrow that returns to it (the list underneath keeps its folder, its words and its place). Header: the back arrow, the space's picture
 * and name, how many topics the person reads in it, and «موضوع جديد» for whoever may open topics (the space's manager and the owner: the server says
 * `canCreateTopic`, and decides again). Under it: the topics, the managers' pin first and then the newest activity (the person's own «ترتيب» of this
 * space wins inside those groups: `forumRows`), the archived ones (the managers receive them) folded under «المؤرشفة».
 *
 * It reads only the C1.4 cache (`useChatSpace`: the topics the server let this person read; a restricted topic they are outside of is not in it, so
 * it is never named here) and draws the same rows as the list. A topic of another space still goes through `keepInSpace` when it is opened, as today.
 */
export function ForumView({
  spaceId,
  variant,
  userId,
  guest,
  rowMenu,
  canPurge,
  selectedId,
}: {
  spaceId: string;
  variant: "column" | "screen";
  userId: string;
  guest: boolean;
  rowMenu: boolean;
  canPurge: boolean;
  selectedId: string | null;
}) {
  const tall = variant === "screen";
  const searchId = useId();
  const day = useDayKey();
  const { space, rows, isPending, isError, refetch } = useChatSpace(spaceId);
  const orders = useChatOrders(!guest);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const words = normalizeQuery(query);
  const shown = useMemo(() => forumRows(rows, spaceId, orders, words), [rows, spaceId, orders, words]);
  // «مجموعات المواضيع»: a space with groups draws one row per group (and «عام»); a search looks at the topics themselves, flat, as ever
  const { groups } = useSpaceGroups(spaceId);
  const canManage = space?.canModerate === true;
  const groupMode = groups.length > 0 && !words;
  const generalName = ct("chatgrp.general");
  const [open, setOpen] = useState<GroupPick | null>(null);
  const [arranging, setArranging] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [moving, setMoving] = useState<ChatRowDto | null>(null);
  const { reorder } = useGroupActions(spaceId);
  const items = useMemo(() => (groupMode ? groupedForumItems(shown, groups, generalName, { showEmpty: canManage }) : forumItems(shown)), [groupMode, shown, groups, generalName, canManage]);
  const menu = useMemo<RowMenuContext>(
    () => ({ enabled: rowMenu, canPurge, canModerate: canManage, ...(groupMode && canManage ? { onMoveToGroup: (row: ChatRowDto) => setMoving(row) } : {}) }),
    [rowMenu, canPurge, canManage, groupMode],
  );
  const openGroup = (model: { id: string | null; name: string; emoji: string | null }) => setOpen({ id: model.id, name: model.name, emoji: model.emoji });
  const { sections, settled } = useSpaceSections(spaceId, creating);

  return (
    <div data-chat-forum="" data-space-id={spaceId} className="absolute inset-0 z-40 flex min-h-0 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-1">
        <Link
          href={chatHref.list}
          scroll={false}
          prefetch
          aria-label={ct("chatui.forum.back")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        {space ? (
          <>
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-lg">
              {space.emoji ?? "🏢"}
            </span>
            <div className="min-w-0 flex-1 ps-2">
              <h2 className="truncate text-base font-semibold leading-5">
                <bdi>{space.name}</bdi>
              </h2>
              <p className="truncate text-xs leading-4 text-fg-muted">{ctCount("chatui.forum.topics", rows.filter((row) => !row.archived).length)}</p>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1 ps-2" />
        )}
        {canManage && groupMode && groups.length > 1 ? (
          <button
            type="button"
            aria-label={ct(arranging ? "chatgrp.arrange_done" : "chatgrp.arrange")}
            title={ct(arranging ? "chatgrp.arrange_done" : "chatgrp.arrange")}
            aria-pressed={arranging}
            data-groups-arrange=""
            onClick={() => setArranging((on) => !on)}
            className={cn("grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", arranging && "bg-accent/15 text-accent")}
          >
            <ArrowUpDown className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        {canManage ? (
          <button
            type="button"
            aria-label={ct("chatgrp.new")}
            title={ct("chatgrp.new")}
            data-new-group-button=""
            onClick={() => setNewGroup(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FolderPlus className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        {space?.canCreateTopic ? (
          <button
            type="button"
            aria-label={ct("chath.topic.new")}
            title={ct("chath.topic.new")}
            onClick={() => setCreating(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {space ? <ListHeader query={query} onQuery={setQuery} searchId={searchId} /> : null}

      {isPending && !space ? (
        <ListSkeleton tall={tall} />
      ) : isError && !space ? (
        <div className="p-3">
          <p role="alert" className="text-sm text-danger">
            {ct("chatui.forum.not_found")}
          </p>
          <button type="button" onClick={() => void refetch()} className="mt-2 inline-flex min-h-11 items-center underline">
            {ct("chath.retry")}
          </button>
        </div>
      ) : arranging && groupMode ? (
        <ArrangeRows listId={`groups-${spaceId}`} entries={groups.map((g) => ({ id: g.id, label: g.name, emoji: g.emoji }))} onReorder={(ids) => reorder.mutate(ids)} />
      ) : items.length === 0 ? (
        words ? (
          <ListEmpty folder="all" query={words} />
        ) : (
          <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
            {ct("chath.no_topics")}
          </p>
        )
      ) : (
        <VirtualRows items={items} tall={tall} selectedId={selectedId} userId={userId} menu={menu} label={ct("chatui.forum.rows")} day={day} onOpenGroup={openGroup} />
      )}
      {isError && space ? <ListError onRetry={() => void refetch()} /> : null}

      {open ? <GroupTopicsPane spaceId={spaceId} group={open} rows={rows} groups={groups} orders={orders} canManage={canManage} variant={variant} userId={userId} menu={menu} selectedId={selectedId} onBack={() => setOpen(null)} onEdited={(next) => setOpen((now) => (now ? { ...now, ...next } : now))} /> : null}
      {newGroup ? <NewTopicGroupDialog spaceId={spaceId} onClose={() => setNewGroup(false)} /> : null}
      {moving ? <MoveToGroupDialog row={moving} spaceId={spaceId} groups={groups} current={groupOfRow(moving, groups)} onClose={() => setMoving(null)} /> : null}
      {space?.canCreateTopic && creating && settled ? <NewTopicDialog open onOpenChange={setCreating} space={{ id: spaceId, name: space.name, sections }} /> : null}
    </div>
  );
}
