"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalToast } from "@/components/ui/toast";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import type { GroupMeta } from "@/lib/chat/v2/groups";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { useGroupActions } from "@/lib/chat/v2/use-space-groups";

/** «مجموعة جديدة»: a name (and, if wanted, one emoji); the new group is empty and goes to the end. The server decides who may (the space's admin, the owner). */
export function NewTopicGroupDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const toast = useOptionalToast();
  const { create } = useGroupActions(spaceId);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const clean = name.trim();
  const submit = () => {
    if (!clean || create.isPending) return;
    create.mutate(
      { name: clean, ...(emoji.trim() ? { emoji: emoji.trim() } : {}) },
      { onSuccess: onClose, onError: () => toast?.toast(ct("chatgrp.failed"), "error") },
    );
  };
  return (
    <Modal open title={ct("chatgrp.new_title")} onClose={onClose}>
      <form
        data-new-group=""
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block text-xs font-medium text-fg-muted" htmlFor="new-group-name">
          {ct("chatgrp.name")}
        </label>
        <Input id="new-group-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        <label className="block text-xs font-medium text-fg-muted" htmlFor="new-group-emoji">
          {ct("chatgrp.emoji")}
        </label>
        <Input id="new-group-emoji" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} className="w-24" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            {ct("chatgrp.cancel")}
          </Button>
          <Button type="submit" disabled={!clean || create.isPending}>
            {ct("chatgrp.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** «نقل إلى مجموعة»: the groups of the topic's space and «عام»; the one it is in is ticked. One tap moves it (the topic's own settings door, `PATCH /api/topics/:id`). */
export function MoveToGroupDialog({ row, spaceId, groups, current, onClose }: { row: Pick<ChatRowDto, "id" | "title">; spaceId: string; groups: readonly GroupMeta[]; current: string | null; onClose: () => void }) {
  const toast = useOptionalToast();
  const { move } = useGroupActions(spaceId);
  const choose = (groupId: string | null) => {
    if (groupId === current) {
      onClose();
      return;
    }
    move.mutate(
      { topicId: row.id, groupId },
      {
        onSuccess: () => {
          toast?.toast(ct("chatgrp.moved"), "success");
          onClose();
        },
        onError: () => toast?.toast(ct("chatgrp.failed"), "error"),
      },
    );
  };
  const options: { id: string | null; name: string; emoji: string }[] = [...groups.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji ?? "📁" })), { id: null, name: ct("chatgrp.move_general"), emoji: "🗂️" }];
  return (
    <Modal open title={ct("chatgrp.move_title", { title: row.title })} onClose={onClose}>
      <ul data-move-to-group="" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {options.map((option) => (
          <li key={option.id ?? "general"}>
            <button
              type="button"
              data-move-option={option.id ?? "general"}
              disabled={move.isPending}
              onClick={() => choose(option.id)}
              className={cn("flex min-h-12 w-full items-center gap-3 px-3 text-start text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-60", option.id === current && "font-semibold text-accent")}
            >
              <span aria-hidden="true" className="text-lg">
                {option.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <bdi>{option.name}</bdi>
              </span>
              {option.id === current ? <span aria-hidden="true">✓</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
