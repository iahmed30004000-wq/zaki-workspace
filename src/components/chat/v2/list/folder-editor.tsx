"use client";

import React, { useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Grip, SortableItem, SortableList } from "@/components/shell/nav-sort";
import { Input } from "@/components/ui/input";
import { useChatList } from "@/lib/chat/cache";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import {
  FOLDER_EMOJIS,
  addFolder,
  cleanFolderName,
  newFolderId,
  pruneUnknown,
  removeFolder,
  renameFolder,
  reorderFolders,
  spacesOfRows,
  toggleChat,
  toggleSpace,
  unknownCount,
  updateFolder,
} from "@/lib/chat/folders";
import { rowMatches } from "@/lib/chat/list-folders";
import { BUILTIN_TABS, FOLDER_NAME_MAX, MAX_FOLDERS, MAX_FOLDER_CHATS, type BuiltinTab, type ChatFolderDef } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { useChatPrefs, useSaveChatPrefs } from "./folder-tabs";

/**
 * C3a.2 — the folder editor: create, rename, pick an emoji, choose what goes in (private chats · spaces · mentions · chats by hand · whole spaces), choose
 * what stays out (muted · read · archived), reorder by dragging (the grip, or the keyboard: Space lifts, the arrows move), delete. A reusable, CONTROLLED
 * component: it holds no folders of its own, it hands each change to `onChange`. C4.1's «المجلدات» settings page mounts `ChatFoldersSettings` (the connected
 * one below); the chat list can mount `FolderEditor` itself where a sheet «تعديل المجلدات» is wanted. Every change is made by the pure moves of
 * `src/lib/chat/folders.ts`, which keep to the schema's limits (10 folders, a name of 12, 100 chats, 50 spaces).
 *
 * `chats` are the rows of the C1 list cache (the person's readable chats and nothing else): a chat a folder lists that is not among them is only COUNTED
 * («اختيارات ما عادت متاحة إلك»), never named. With `hiddenTabs` + `onHiddenTabsChange` the editor also offers one checkbox per built-in tab (hide what you do not use).
 */
export interface FolderEditorProps {
  folders: readonly ChatFolderDef[];
  onChange: (next: ChatFolderDef[]) => void;
  chats: readonly ChatRowDto[];
  hiddenTabs?: readonly BuiltinTab[];
  onHiddenTabsChange?: (next: BuiltinTab[]) => void;
  /** the list the picker reads has loaded: until then no pick is called unavailable and none can be cleared (default true) */
  chatsLoaded?: boolean;
  /** a guest has no private chats, so «خاص» is not a tab to show or hide */
  guest?: boolean;
  /** the id of the folder drawn open (the settings page may deep-link one) */
  initiallyOpen?: string | null;
  disabled?: boolean;
}

const CHECKBOX = "size-5 shrink-0 accent-accent disabled:opacity-50";

function Check({ checked, onChange, label, disabled, data, hint }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; data: Record<string, string>; hint?: string }) {
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

export function FolderEditor({ folders, onChange, chats, chatsLoaded = true, hiddenTabs, onHiddenTabsChange, guest = false, initiallyOpen = null, disabled = false }: FolderEditorProps) {
  const [open, setOpen] = useState<string | null>(initiallyOpen);
  const list = folders as ChatFolderDef[];
  const full = list.length >= MAX_FOLDERS;

  const add = () => {
    const id = newFolderId(new Set(list.map((f) => f.id)));
    const next = addFolder(list, { id, name: ct("chatfld.default_name") });
    if (next !== list) {
      onChange(next);
      setOpen(id);
    }
  };

  return (
    <div data-folder-editor="" className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">{ct("chatfld.hint")}</p>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-fg-muted">{ct("chatfld.empty")}</p>
      ) : (
        <SortableList
          id="chat-folders"
          entries={list.map((f) => ({ id: f.id, label: f.name }))}
          axis="vertical"
          onReorder={(keys) => onChange(reorderFolders(list, keys))}
        >
          <ul className="flex flex-col gap-2">
            {list.map((folder) => (
              <SortableItem key={folder.id} id={folder.id} className="list-none rounded-xl border border-border bg-surface">
                {({ props }) => (
                  <div data-folder-id={folder.id}>
                    <div className="flex items-center gap-1 px-2">
                      <Grip handle={{ ...props, "data-folder-grip": "" }} label={folder.name} />
                      <button
                        type="button"
                        data-folder-open=""
                        aria-expanded={open === folder.id}
                        onClick={() => setOpen(open === folder.id ? null : folder.id)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {folder.emoji ? <span aria-hidden="true">{folder.emoji}</span> : null}
                        <span className="truncate">{folder.name}</span>
                      </button>
                      <button
                        type="button"
                        data-folder-delete=""
                        aria-label={ct("chatfld.delete", { name: folder.name })}
                        disabled={disabled}
                        onClick={() => {
                          onChange(removeFolder(list, folder.id));
                          if (open === folder.id) setOpen(null);
                        }}
                        className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    {open === folder.id ? <FolderDetail folder={folder} list={list} onChange={onChange} chats={chats} chatsLoaded={chatsLoaded} disabled={disabled} /> : null}
                  </div>
                )}
              </SortableItem>
            ))}
          </ul>
        </SortableList>
      )}

      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-folder-add=""
          disabled={full || disabled}
          onClick={add}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-4" />
          {ct("chatfld.add")}
        </button>
        {full ? <p className="text-xs text-fg-muted">{ct("chatfld.limit")}</p> : null}
      </div>

      {hiddenTabs && onHiddenTabsChange ? (
        <section className="flex flex-col gap-1 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-fg">{ct("chatfld.builtin")}</h3>
          <p className="text-xs text-fg-muted">{ct("chatfld.builtin_hint")}</p>
          {BUILTIN_TABS.filter((key) => !(guest && key === "dm")).map((key) => {
            const shown = !hiddenTabs.includes(key);
            return (
              <Check
                key={key}
                checked={shown}
                disabled={disabled}
                label={ct("chatfld.builtin_switch", { name: ct(`chatui.folder.${key}`) })}
                data={{ "data-builtin-tab": key }}
                onChange={(on) => onHiddenTabsChange(on ? hiddenTabs.filter((k) => k !== key) : [...hiddenTabs, key])}
              />
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

/** One open folder: its name, emoji, what goes in and what stays out. */
function FolderDetail({ folder, list, onChange, chats, chatsLoaded, disabled }: { folder: ChatFolderDef; list: ChatFolderDef[]; onChange: (next: ChatFolderDef[]) => void; chats: readonly ChatRowDto[]; chatsLoaded: boolean; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => chats.filter((row) => row.kind !== "SPACE"), [chats]);
  const spaces = useMemo(() => spacesOfRows(chats), [chats]);
  const known = useMemo(() => ({ chats: new Set(candidates.map((r) => r.id)), spaces: new Set(spaces.map((s) => s.id)) }), [candidates, spaces]);
  const shown = useMemo(() => candidates.filter((row) => rowMatches(row, query)), [candidates, query]);
  // a pick is «not visible» only once the list has really come: an empty list that is still loading says nothing about them
  const stale = chatsLoaded ? unknownCount(folder, known) : 0;
  const chosen = folder.include.conversationIds.length;
  const { include, exclude } = folder;

  const setInclude = (changes: Partial<ChatFolderDef["include"]>) => onChange(updateFolder(list, folder.id, { include: { ...include, ...changes } }));
  const setExclude = (changes: Partial<ChatFolderDef["exclude"]>) => onChange(updateFolder(list, folder.id, { exclude: { ...exclude, ...changes } }));

  return (
    <div data-folder-detail="" className="flex flex-col gap-4 border-t border-border p-3">
      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{ct("chatfld.name")}</span>
          <Input
            key={folder.id}
            defaultValue={folder.name}
            maxLength={FOLDER_NAME_MAX}
            disabled={disabled}
            aria-describedby={`${folder.id}-name-hint`}
            // the name is saved when the person leaves the box or presses Enter, never on every key (each save is a write); an empty box goes back to the old name
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const clean = cleanFolderName(e.target.value);
              if (!clean) e.target.value = folder.name;
              else if (clean !== folder.name) onChange(renameFolder(list, folder.id, clean));
            }}
          />
          <span id={`${folder.id}-name-hint`} className="mt-1 block text-xs text-fg-muted">
            {ct("chatfld.name_hint")}
          </span>
        </label>
        <div role="group" aria-label={ct("chatfld.emoji")} className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-label={ct("chatfld.emoji_none")}
            aria-pressed={!folder.emoji}
            disabled={disabled}
            onClick={() => onChange(updateFolder(list, folder.id, { emoji: undefined }))}
            className={cn("min-h-11 rounded-lg border px-3 text-xs", !folder.emoji ? "border-accent text-accent" : "border-border text-fg-muted")}
          >
            {ct("chatfld.emoji_none")}
          </button>
          {FOLDER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={ct("chatfld.emoji_option", { emoji })}
              aria-pressed={folder.emoji === emoji}
              disabled={disabled}
              onClick={() => onChange(updateFolder(list, folder.id, { emoji }))}
              className={cn("grid size-11 place-items-center rounded-lg border text-lg", folder.emoji === emoji ? "border-accent bg-accent/10" : "border-border")}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <section className="flex flex-col">
        <h4 className="text-sm font-semibold text-fg">{ct("chatfld.include")}</h4>
        <Check checked={include.dms === true} disabled={disabled} label={ct("chatfld.inc.dms")} data={{ "data-rule": "dms" }} onChange={(on) => setInclude({ dms: on })} />
        <Check checked={include.spaces === true} disabled={disabled} label={ct("chatfld.inc.spaces")} data={{ "data-rule": "spaces" }} onChange={(on) => setInclude({ spaces: on })} />
        <Check checked={include.mentions === true} disabled={disabled} label={ct("chatfld.inc.mentions")} data={{ "data-rule": "mentions" }} onChange={(on) => setInclude({ mentions: on })} />
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg">{ct("chatfld.chats")}</h4>
          <span className="text-xs tabular-nums text-fg-muted">{ct("chatfld.chats_count", { n: chosen })}</span>
        </div>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ct("chatfld.search")} aria-label={ct("chatfld.search")} />
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border px-2">
          {shown.length === 0 ? (
            <p className="py-3 text-center text-sm text-fg-muted">{ct("chatfld.no_chats")}</p>
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
                  onChange={() => onChange(toggleChat(list, folder.id, row.id))}
                />
              );
            })
          )}
        </div>
      </section>

      {spaces.length > 0 ? (
        <section className="flex flex-col">
          <h4 className="text-sm font-semibold text-fg">{ct("chatfld.spaces_whole")}</h4>
          {spaces.map((space) => (
            <Check
              key={space.id}
              checked={include.spaceIds.includes(space.id)}
              disabled={disabled}
              label={space.name}
              data={{ "data-space-pick": space.id }}
              onChange={() => onChange(toggleSpace(list, folder.id, space.id))}
            />
          ))}
        </section>
      ) : null}

      <section className="flex flex-col">
        <h4 className="text-sm font-semibold text-fg">{ct("chatfld.exclude")}</h4>
        <p className="text-xs text-fg-muted">{ct("chatfld.exclude_hint")}</p>
        <Check checked={exclude.muted === true} disabled={disabled} label={ct("chatfld.exc.muted")} data={{ "data-rule": "exclude-muted" }} onChange={(on) => setExclude({ muted: on })} />
        <Check checked={exclude.read === true} disabled={disabled} label={ct("chatfld.exc.read")} data={{ "data-rule": "exclude-read" }} onChange={(on) => setExclude({ read: on })} />
        <Check checked={exclude.archived === true} disabled={disabled} label={ct("chatfld.exc.archived")} data={{ "data-rule": "exclude-archived" }} onChange={(on) => setExclude({ archived: on })} />
      </section>

      {stale > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-3 text-sm text-fg-muted">
          <span>{ct("chatfld.stale", { n: stale })}</span>
          <button
            type="button"
            aria-label={ct("chatfld.stale_clear")}
            disabled={disabled}
            onClick={() => onChange(pruneUnknown(list, folder.id, known))}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs text-fg hover:bg-surface"
          >
            {ct("chatfld.stale_clear")}
          </button>
        </div>
      ) : null}

      <p className="text-xs text-fg-muted">{ct("chatfld.delete_note")}</p>
    </div>
  );
}

type Status = "idle" | "saving" | "saved" | "failed";

/**
 * The connected editor C4.1's «المجلدات» page mounts: it reads the person's prefs and the rows of the list cache, shows the editor, and saves each change
 * (the folders under the active company's id, the hidden tabs). What the person just did shows at once (the cache is updated before the server answers, and the
 * requests go out one after another); if a save is refused it says so and the screen goes back to what the server holds. With the company's switch
 * `chatFolders` off it says the folders are off.
 */
export function ChatFoldersSettings({ guest = false }: { guest?: boolean }) {
  const prefs = useChatPrefs();
  const rows = useChatList("all");
  const save = useSaveChatPrefs();
  const [status, setStatus] = useState<Status>("idle");
  const inflight = useRef(0);
  const chats = useMemo(() => [...rows.rows, ...rows.archivedRows], [rows.rows, rows.archivedRows]);

  // the cache shows each change at once and sends the saves one after another (`saveChatPrefs`); a refused one puts the screen back to what the server holds
  const send = (patch: Parameters<typeof save>[0]) => {
    inflight.current += 1;
    setStatus("saving");
    save(patch).then(
      () => {
        inflight.current -= 1;
        if (inflight.current === 0) setStatus("saved");
      },
      () => {
        inflight.current -= 1;
        setStatus("failed");
      },
    );
  };

  if (!prefs.loaded) return <p role="status" className="text-sm text-fg-muted">{ct("chatfld.loading")}</p>;
  if (!prefs.foldersOn || !prefs.orgId) return <p role="status" className="text-sm text-fg-muted">{ct("chatfld.off")}</p>;
  const orgId = prefs.orgId;

  return (
    <div className="flex flex-col gap-3">
      <FolderEditor
        folders={prefs.folders}
        chats={chats}
        chatsLoaded={!rows.isPending && !rows.isError}
        guest={guest}
        hiddenTabs={prefs.hidden}
        onChange={(next) => send({ folders: { [orgId]: next.length > 0 ? next : null } })}
        onHiddenTabsChange={(next) => send({ tabs: next.length > 0 ? { hidden: next } : null })}
      />
      <p role="status" aria-live="polite" className={cn("min-h-5 text-xs", status === "failed" ? "text-danger" : "text-fg-muted")}>
        {status === "saving" ? ct("chatfld.saving") : status === "saved" ? ct("chatfld.saved") : status === "failed" ? ct("chatfld.failed") : ""}
      </p>
    </div>
  );
}
