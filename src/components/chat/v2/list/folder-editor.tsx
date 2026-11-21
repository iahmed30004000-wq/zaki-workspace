"use client";

import React, { useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Grip, SortableItem, SortableList } from "@/components/shell/nav-sort";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { removeFolder, reorderFolders, upsertFolder } from "@/lib/chat/folders";
import { BUILTIN_TABS, MAX_FOLDERS, type BuiltinTab, type ChatFolderDef } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { Check, FolderForm } from "./folder-form";
import { FolderSheet } from "./folder-sheet";
import { useChatPrefs, useSaveChatPrefs } from "./folder-tabs";
import { useFolderChats } from "./use-folder-chats";

/**
 * C3a.2 — the folder editor: create, rename, pick an emoji, choose what goes in (private chats · spaces · mentions · chats by hand · whole spaces), choose
 * what stays out (muted · read · archived), reorder by dragging (the grip, or the keyboard: Space lifts, the arrows move), delete. A reusable, CONTROLLED
 * component: it holds no folders of its own, it hands each change to `onChange`. C4.1's «المجلدات» settings page mounts `ChatFoldersSettings` (the connected
 * one below). Every change is made by the pure moves of `src/lib/chat/folders.ts`, which keep to the schema's limits (10 folders, a name of 12, 100 chats, 50 spaces).
 *
 * S5.3: the body of one open folder is `FolderForm` (`folder-form.tsx`), the SAME body the small sheet of the chat draws; and «مجلد جديد» opens that sheet (a name,
 * an emoji, the chats, ONE «حفظ») instead of writing a nameless «مجلد جديد» first for the person to rename.
 *
 * `chats` are what the picker may offer (the person's readable chats and the topics of their current space, nothing else): a chat a folder lists that is not
 * among them is only COUNTED («اختيارات ما عادت متاحة إلك»), never named. With `hiddenTabs` + `onHiddenTabsChange` the editor also offers one checkbox per built-in tab (hide what you do not use).
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

export function FolderEditor({ folders, onChange, chats, chatsLoaded = true, hiddenTabs, onHiddenTabsChange, guest = false, initiallyOpen = null, disabled = false }: FolderEditorProps) {
  const [open, setOpen] = useState<string | null>(initiallyOpen);
  const [creating, setCreating] = useState(false);
  const list = folders as ChatFolderDef[];
  const full = list.length >= MAX_FOLDERS;

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
                    {open === folder.id ? (
                      <div data-folder-detail="" className="border-t border-border p-3">
                        <FolderForm
                          draft={folder}
                          onChange={(next) => onChange(list.map((f) => (f.id === next.id ? next : f)))}
                          chats={chats}
                          chatsLoaded={chatsLoaded}
                          disabled={disabled}
                          advanced
                        />
                      </div>
                    ) : null}
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
          onClick={() => setCreating(true)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-4" />
          {ct("chatfld.add")}
        </button>
        {full ? <p className="text-xs text-fg-muted">{ct("chatfld.limit")}</p> : null}
      </div>

      {creating ? (
        <FolderSheet
          open
          onOpenChange={(next) => !next && setCreating(false)}
          folder={null}
          list={list}
          chats={chats}
          chatsLoaded={chatsLoaded}
          onSave={(draft) => {
            const next = upsertFolder(list, draft);
            if (next === list) return Promise.resolve(false);
            onChange(next);
            setOpen(draft.id);
            return Promise.resolve(true);
          }}
        />
      ) : null}

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

type Status = "idle" | "saving" | "saved" | "failed";

/**
 * The connected editor C4.1's «المجلدات» page mounts: it reads the person's prefs and the chats the picker offers (the list cache, and the topics of the current
 * space), shows the editor, and saves each change (the folders under the active company's id, the hidden tabs). What the person just did shows at once (the cache is
 * updated before the server answers, and the requests go out one after another); if a save is refused it says so and the screen goes back to what the server holds.
 * With the company's switch `chatFolders` off it says the folders are off.
 */
export function ChatFoldersSettings({ guest = false }: { guest?: boolean }) {
  const prefs = useChatPrefs();
  const { chats, loaded } = useFolderChats();
  const save = useSaveChatPrefs();
  const [status, setStatus] = useState<Status>("idle");
  const inflight = useRef(0);

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
        chatsLoaded={loaded}
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
