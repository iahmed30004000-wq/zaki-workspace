"use client";

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { FOLDER_EMOJIS, cleanFolderName, pruneUnknown, spacesOfRows, toggleChat, toggleSpace, unknownCount } from "@/lib/chat/folders";
import { rowMatches } from "@/lib/chat/list-folders";
import { FOLDER_NAME_MAX, MAX_FOLDER_CHATS, type ChatFolderDef } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * S5.3 — THE ONE BODY of a folder's editor: its name, its emoji and the chats picked on ONE screen with a search box. The small sheet of the chat («+» on the
 * strip, «أضف لمجلد», a long press on a tab) and the settings page's «المجلدات» both draw this component, so there is no second editor to drift. It is
 * CONTROLLED: it holds only what the person typed in the search box; every change goes to `onChange` as the whole folder, made by the pure moves of
 * `src/lib/chat/folders.ts` (which keep to the schema's limits).
 *
 * `chats` is what the picker may offer: the rows of the list and the topics of the current space (`pickableChats`): rows the person may read, nothing else. A
 * pick that is not among them is only COUNTED («اختيارات مش ظاهرة إلك هلأ»), never named.
 */
export interface FolderFormProps {
  draft: ChatFolderDef;
  onChange: (next: ChatFolderDef) => void;
  chats: readonly ChatRowDto[];
  /** the list the picker reads has loaded: until then no pick is called unavailable and none can be cleared (default true) */
  chatsLoaded?: boolean;
  disabled?: boolean;
  /** the rules (private chats · spaces · mentions), whole spaces and the exclusions: the settings page shows them, the small sheet leaves them as they are */
  advanced?: boolean;
  /** `true`: the name is the draft as it is typed (the sheet saves it with the rest); otherwise it is committed when the box loses focus (the settings page: each commit is a write) */
  liveName?: boolean;
  autoFocusName?: boolean;
  /** the height of the list of chats (a class) */
  pickerClassName?: string;
}

const CHECKBOX = "size-5 shrink-0 accent-accent disabled:opacity-50";

export function Check({ checked, onChange, label, disabled, data, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; data: Record<string, string>; hint?: string }) {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 text-sm", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="checkbox" className={CHECKBOX} checked={checked} disabled={disabled === true} onChange={(e) => onChange(e.target.checked)} {...data} />
      <span className="min-w-0 flex-1">
        <span className="block text-fg">{label}</span>
        {hint ? <span className="block text-xs text-fg-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FolderForm({ draft, onChange, chats, chatsLoaded = true, disabled = false, advanced = false, liveName = false, autoFocusName = false, pickerClassName = "max-h-56" }: FolderFormProps) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => chats.filter((row) => row.kind !== "SPACE"), [chats]);
  const spaces = useMemo(() => spacesOfRows(chats), [chats]);
  const known = useMemo(() => ({ chats: new Set(candidates.map((r) => r.id)), spaces: new Set(spaces.map((s) => s.id)) }), [candidates, spaces]);
  const shown = useMemo(() => candidates.filter((row) => rowMatches(row, query)), [candidates, query]);
  // a pick is «not visible» only once the list has really come: an empty list that is still loading says nothing about them
  const stale = chatsLoaded ? unknownCount(draft, known) : 0;
  const chosen = draft.include.conversationIds.length;
  const { include, exclude } = draft;

  // the pure moves work on a list of folders: a list of one is the folder itself
  const move = (fn: (list: ChatFolderDef[]) => ChatFolderDef[]) => onChange(fn([draft])[0] ?? draft);
  const setInclude = (changes: Partial<ChatFolderDef["include"]>) => onChange({ ...draft, include: { ...include, ...changes } });
  const setExclude = (changes: Partial<ChatFolderDef["exclude"]>) => onChange({ ...draft, exclude: { ...exclude, ...changes } });
  const setEmoji = (emoji: string | undefined) => {
    const { emoji: _old, ...rest } = draft;
    onChange(emoji ? { ...rest, emoji } : rest);
  };

  return (
    <div data-folder-form="" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{ct("chatfld.name")}</span>
          {liveName ? (
            <Input
              value={draft.name}
              maxLength={FOLDER_NAME_MAX}
              disabled={disabled}
              autoFocus={autoFocusName}
              placeholder={ct("chatfolders.name_placeholder")}
              data-folder-name=""
              aria-describedby={`${draft.id}-name-hint`}
              onChange={(e) => onChange({ ...draft, name: [...e.target.value].slice(0, FOLDER_NAME_MAX).join("") })}
            />
          ) : (
            <Input
              key={draft.id}
              defaultValue={draft.name}
              maxLength={FOLDER_NAME_MAX}
              disabled={disabled}
              data-folder-name=""
              aria-describedby={`${draft.id}-name-hint`}
              // the name is saved when the person leaves the box or presses Enter, never on every key (each save is a write); an empty box goes back to the old name
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const clean = cleanFolderName(e.target.value);
                if (!clean) e.target.value = draft.name;
                else if (clean !== draft.name) onChange({ ...draft, name: clean });
              }}
            />
          )}
          <span id={`${draft.id}-name-hint`} className="mt-1 block text-xs text-fg-muted">
            {ct("chatfld.name_hint")}
          </span>
        </label>
        <div role="group" aria-label={ct("chatfld.emoji")} className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-label={ct("chatfld.emoji_none")}
            aria-pressed={!draft.emoji}
            disabled={disabled}
            onClick={() => setEmoji(undefined)}
            className={cn("min-h-11 rounded-lg border px-3 text-xs", !draft.emoji ? "border-accent text-accent" : "border-border text-fg-muted")}
          >
            {ct("chatfld.emoji_none")}
          </button>
          {FOLDER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={ct("chatfld.emoji_option", { emoji })}
              aria-pressed={draft.emoji === emoji}
              disabled={disabled}
              onClick={() => setEmoji(emoji)}
              className={cn("grid size-11 place-items-center rounded-lg border text-lg", draft.emoji === emoji ? "border-accent bg-accent/10" : "border-border")}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {advanced ? (
        <section className="flex flex-col">
          <h4 className="text-sm font-semibold text-fg">{ct("chatfld.include")}</h4>
          <Check checked={include.dms === true} disabled={disabled} label={ct("chatfld.inc.dms")} data={{ "data-rule": "dms" }} onChange={(on) => setInclude({ dms: on })} />
          <Check checked={include.spaces === true} disabled={disabled} label={ct("chatfld.inc.spaces")} data={{ "data-rule": "spaces" }} onChange={(on) => setInclude({ spaces: on })} />
          <Check checked={include.mentions === true} disabled={disabled} label={ct("chatfld.inc.mentions")} data={{ "data-rule": "mentions" }} onChange={(on) => setInclude({ mentions: on })} />
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg">{ct(advanced ? "chatfld.chats" : "chatfolders.pick_title")}</h4>
          <span className="text-xs tabular-nums text-fg-muted">{advanced ? ct("chatfld.chats_count", { n: chosen }) : ct("chatfolders.pick_count", { n: chosen })}</span>
        </div>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ct("chatfolders.search")} aria-label={ct("chatfld.search")} />
        <div className={cn("overflow-y-auto rounded-lg border border-border px-2", pickerClassName)}>
          {shown.length === 0 ? (
            <p className="py-3 text-center text-sm text-fg-muted">{ct(query.trim() ? "chatfolders.no_match" : "chatfld.no_chats")}</p>
          ) : (
            shown.map((row) => {
              const picked = include.conversationIds.includes(row.id);
              return (
                <Check
                  key={row.id}
                  checked={picked}
                  disabled={disabled || (!picked && chosen >= MAX_FOLDER_CHATS)}
                  label={row.title}
                  {...(row.space && row.kind === "TOPIC" ? { hint: row.space.name } : {})}
                  data={{ "data-chat-pick": row.id }}
                  onChange={() => move((list) => toggleChat(list, draft.id, row.id))}
                />
              );
            })
          )}
        </div>
        {advanced ? null : <p className="text-xs text-fg-muted">{ct("chatfolders.pick_hint")}</p>}
      </section>

      {advanced && spaces.length > 0 ? (
        <section className="flex flex-col">
          <h4 className="text-sm font-semibold text-fg">{ct("chatfld.spaces_whole")}</h4>
          {spaces.map((space) => (
            <Check
              key={space.id}
              checked={include.spaceIds.includes(space.id)}
              disabled={disabled}
              label={space.name}
              data={{ "data-space-pick": space.id }}
              onChange={() => move((list) => toggleSpace(list, draft.id, space.id))}
            />
          ))}
        </section>
      ) : null}

      {advanced ? (
        <section className="flex flex-col">
          <h4 className="text-sm font-semibold text-fg">{ct("chatfld.exclude")}</h4>
          <p className="text-xs text-fg-muted">{ct("chatfld.exclude_hint")}</p>
          <Check checked={exclude.muted === true} disabled={disabled} label={ct("chatfld.exc.muted")} data={{ "data-rule": "exclude-muted" }} onChange={(on) => setExclude({ muted: on })} />
          <Check checked={exclude.read === true} disabled={disabled} label={ct("chatfld.exc.read")} data={{ "data-rule": "exclude-read" }} onChange={(on) => setExclude({ read: on })} />
          <Check checked={exclude.archived === true} disabled={disabled} label={ct("chatfld.exc.archived")} data={{ "data-rule": "exclude-archived" }} onChange={(on) => setExclude({ archived: on })} />
        </section>
      ) : null}

      {advanced && stale > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-3 text-sm text-fg-muted">
          <span>{ct("chatfld.stale", { n: stale })}</span>
          <button
            type="button"
            aria-label={ct("chatfld.stale_clear")}
            disabled={disabled}
            onClick={() => move((list) => pruneUnknown(list, draft.id, known))}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs text-fg hover:bg-surface"
          >
            {ct("chatfld.stale_clear")}
          </button>
        </div>
      ) : null}

      {advanced ? <p className="text-xs text-fg-muted">{ct("chatfld.delete_note")}</p> : null}
    </div>
  );
}
