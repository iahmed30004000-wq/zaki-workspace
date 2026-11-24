"use client";

import React, { useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalToast } from "@/components/ui/toast";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import type { GroupMeta } from "@/lib/chat/v2/groups";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { useGroupActions } from "@/lib/chat/v2/use-space-groups";
import { GroupFace } from "./group-face";

/** The emojis offered for a group's picture (a tap picks one; a second tap on the same one takes it off); anything else can still be typed in the box beside them. */
export const GROUP_EMOJIS = ["📁", "💼", "📊", "📣", "🛒", "📦", "🚚", "🎯", "💬", "🧾", "🛠️", "📞", "🎨", "📷", "🧪", "⭐", "🔥", "💡", "✅", "🏷️", "📅", "👥", "🧑‍💼", "🌍"] as const;

/** One row of emoji choices plus a free box: what the new-group and edit-group dialogs share. */
function EmojiChoices({ value, onChange, id }: { value: string; onChange: (next: string) => void; id: string }) {
  return (
    <div data-group-emojis="" className="space-y-2">
      <div role="group" aria-label={ct("chatgrp.emoji")} className="grid grid-cols-8 gap-1">
        {GROUP_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            data-group-emoji={e}
            aria-pressed={value === e}
            onClick={() => onChange(value === e ? "" : e)}
            className={cn("grid size-10 place-items-center rounded-lg text-xl hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", value === e && "bg-accent/15 ring-2 ring-accent")}
          >
            <span aria-hidden="true">{e}</span>
          </button>
        ))}
      </div>
      <Input id={id} value={value} maxLength={8} onChange={(event) => onChange(event.target.value)} className="w-28" aria-label={ct("chatgrp.emoji")} />
    </div>
  );
}

/** «تعديل المجموعة»: the name and the picture (an emoji) of a group, for whoever may arrange the space; the server decides again (`PATCH /api/groups/:id`). */
export function EditTopicGroupDialog({ spaceId, group, onClose, onSaved }: { spaceId: string; group: { id: string; name: string; emoji: string | null; imageUrl?: string | null }; onClose: () => void; onSaved?: (next: { name: string; emoji: string | null }) => void }) {
  const toast = useOptionalToast();
  const { update, picture, clearPicture } = useGroupActions(spaceId);
  const picker = useRef<HTMLInputElement | null>(null);
  const [image, setImage] = useState<string | null>(group.imageUrl ?? null);
  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState(group.emoji ?? "");
  const clean = name.trim();
  const submit = () => {
    if (!clean || update.isPending) return;
    const nextEmoji = emoji.trim() === "" ? null : emoji.trim();
    update.mutate(
      { groupId: group.id, name: clean, emoji: nextEmoji },
      {
        onSuccess: () => {
          onSaved?.({ name: clean, emoji: nextEmoji });
          onClose();
        },
        onError: () => toast?.toast(ct("chatgrp.failed"), "error"),
      },
    );
  };
  return (
    <Modal open title={ct("chatgrp.edit_title")} onClose={onClose}>
      <form
        data-edit-group=""
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block text-xs font-medium text-fg-muted" htmlFor="edit-group-name">
          {ct("chatgrp.name")}
        </label>
        <Input id="edit-group-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        <div data-group-picture="" className="flex items-center gap-3">
          <GroupFace emoji={emoji.trim() || null} imageUrl={image} fallback="📁" className="size-14 text-2xl" />
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            data-group-picture-input=""
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              picture.mutate({ groupId: group.id, file }, { onSuccess: (made) => setImage(made.imageUrl), onError: () => toast?.toast(ct("chatgrp.failed"), "error") });
            }}
          />
          <Button type="button" variant="secondary" disabled={picture.isPending || clearPicture.isPending} onClick={() => picker.current?.click()}>
            {image ? ct("chatgrp.picture_change") : ct("chatgrp.picture_add")}
          </Button>
          {image ? (
            <Button
              type="button"
              variant="ghost"
              disabled={picture.isPending || clearPicture.isPending}
              onClick={() => clearPicture.mutate(group.id, { onSuccess: () => setImage(null), onError: () => toast?.toast(ct("chatgrp.failed"), "error") })}
            >
              {ct("chatgrp.picture_remove")}
            </Button>
          ) : null}
        </div>
        <label className="block text-xs font-medium text-fg-muted" htmlFor="edit-group-emoji">
          {ct("chatgrp.emoji")}
        </label>
        <EmojiChoices id="edit-group-emoji" value={emoji} onChange={setEmoji} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
            {ct("chatgrp.cancel")}
          </Button>
          <Button type="submit" disabled={!clean || update.isPending}>
            {ct("chatgrp.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

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
        <EmojiChoices id="new-group-emoji" value={emoji} onChange={setEmoji} />
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
