"use client";

import React, { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "@/lib/api-client";
import type { RowMenuContext } from "@/components/chat/v2/row-menu";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { forumItems, forumRows, type SavedOrders } from "@/lib/chat/list-folders";
import { reorderWithin, topicsOfGroup, type GroupMeta } from "@/lib/chat/v2/groups";
import { ct, ctCount } from "@/lib/chat/text";
import { spaceScope } from "@/lib/chat/order";
import { CHAT_ORDERS_KEY } from "@/lib/chat/v2/use-orders";
import { useDayKey } from "@/lib/chat/v2/use-day";
import { cn } from "@/lib/utils";
import { ArrangeRows } from "./group-arrange";
import { EditTopicGroupDialog } from "./group-dialogs";
import { GroupFace } from "./group-face";
import { VirtualRows } from "./virtual-rows";

/**
 * «مجموعات المواضيع» — what a tap on a group row opens: the group's own topics (Telegram's forum group), with a back arrow to the groups. The topics are the very rows of the list
 * (`topicsOfGroup`) in the person's order, the managers' pin first, the archived ones folded at the end for the managers. A manager can switch to «ترتيب» and drag the topics of
 * THIS group: the new order is saved as the person's own order of the space (`space:<id>`), changing only the places this group's topics hold.
 */
export interface GroupPick {
  /** the space the group is of, when the list that opened it is a folder's (not the space's own) */
  spaceId?: string;
  id: string | null;
  name: string;
  emoji: string | null;
}

export function GroupTopicsPane({
  spaceId,
  group,
  rows,
  groups,
  orders,
  canManage,
  variant,
  userId,
  menu,
  selectedId,
  onBack,
  onEdited,
}: {
  spaceId: string;
  group: GroupPick;
  rows: readonly ChatRowDto[];
  groups: readonly GroupMeta[];
  orders: SavedOrders;
  canManage: boolean;
  variant: "column" | "screen";
  userId: string;
  menu: RowMenuContext;
  selectedId: string | null;
  onBack: () => void;
  /** a manager changed the group's name or picture here: the list that opened it keeps the new ones */
  onEdited?: (next: { name: string; emoji: string | null }) => void;
}) {
  const tall = variant === "screen";
  // the picture is read from the live groups (the pick only holds the name and emoji it was opened with), so a new picture shows at once
  const pictureOf = groups.find((g) => g.id === group.id)?.imageUrl ?? null;
  const day = useDayKey();
  const qc = useQueryClient();
  const [arranging, setArranging] = useState(false);
  const [editing, setEditing] = useState(false);
  const ordered = useMemo(() => forumRows(rows, spaceId, orders), [rows, spaceId, orders]);
  const inside = useMemo(() => topicsOfGroup(ordered, group.id, groups), [ordered, group.id, groups]);
  const live = useMemo(() => inside.filter((r) => !r.archived && !r.archivedByMe), [inside]);
  const items = useMemo(() => forumItems(inside), [inside]);

  const save = (ids: string[]) => {
    const full = ordered.filter((r) => !r.archived && !r.archivedByMe).map((r) => r.id);
    const next = reorderWithin(full, live.map((r) => r.id), ids);
    void apiPut("/api/chat/order", { scope: spaceScope(spaceId), order: next }).then(() => qc.invalidateQueries({ queryKey: CHAT_ORDERS_KEY }));
  };

  return (
    <div data-group-topics={group.id ?? "general"} className="absolute inset-0 z-30 flex min-h-0 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={ct("chatgrp.back")}
          data-group-back=""
          className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
        <GroupFace emoji={group.emoji} imageUrl={pictureOf} fallback={group.id === null ? "🗂️" : "📁"} className="size-9 text-lg" />
        <div className="min-w-0 flex-1 ps-2">
          <h2 className="truncate text-base font-semibold leading-5">
            <bdi>{group.name}</bdi>
          </h2>
          <p className="truncate text-xs leading-4 text-fg-muted">{ctCount("chatui.forum.topics", live.length)}</p>
        </div>
        {canManage && group.id !== null ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={ct("chatgrp.edit")}
            title={ct("chatgrp.edit")}
            data-group-edit=""
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Pencil className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        {canManage && live.length > 1 ? (
          <button
            type="button"
            onClick={() => setArranging((on) => !on)}
            aria-pressed={arranging}
            aria-label={ct(arranging ? "chatgrp.arrange_done" : "chatgrp.arrange")}
            title={ct(arranging ? "chatgrp.arrange_done" : "chatgrp.arrange")}
            data-group-arrange=""
            className={cn("grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", arranging && "bg-accent/15 text-accent")}
          >
            <ArrowUpDown className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {arranging ? (
        <ArrangeRows listId={`group-topics-${group.id ?? "general"}`} entries={live.map((r) => ({ id: r.id, label: r.title, emoji: r.emoji }))} onReorder={save} />
      ) : items.length === 0 ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
          {ct("chatgrp.empty")}
        </p>
      ) : (
        <VirtualRows items={items} tall={tall} selectedId={selectedId} userId={userId} menu={menu} label={ct("chatui.forum.rows")} day={day} />
      )}
      {editing && group.id !== null ? <EditTopicGroupDialog spaceId={spaceId} group={{ id: group.id, name: group.name, emoji: group.emoji, imageUrl: pictureOf }} onClose={() => setEditing(false)} {...(onEdited ? { onSaved: onEdited } : {})} /> : null}
    </div>
  );
}
