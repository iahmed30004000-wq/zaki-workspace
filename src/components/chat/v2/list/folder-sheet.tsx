"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useOptionalToast } from "@/components/ui/toast";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { cleanFolderName, newFolderId, upsertFolder } from "@/lib/chat/folders";
import { MAX_FOLDERS, type ChatFolderDef, type ChatPrefsPatch } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { FolderForm } from "./folder-form";
import { useChatPrefs, useSaveChatPrefs } from "./folder-tabs";
import { useFolderChats } from "./use-folder-chats";

/**
 * S5.3 — the small sheet that makes or edits ONE folder from inside the chat: a name, an emoji and the chats picked on one screen with a search box, then ONE
 * «حفظ». Nothing is written while the person ticks: the draft lives in the sheet, and the save is ONE write of the company's whole list of folders (before,
 * «مجلد جديد» was written first, then every tick was a write of its own). The body is `FolderForm`, the same one the settings page draws.
 */

/**
 * The one write of the sheet: the folder (new, or replacing the old one) goes into the company's list and that list is saved once. False (nothing sent) for an
 * empty name or a new folder when the ten are used up; false too when the server refused (it never throws).
 */
export async function saveFolderDraft(opts: { save: (patch: ChatPrefsPatch) => Promise<unknown>; orgId: string; list: ChatFolderDef[]; draft: ChatFolderDef }): Promise<boolean> {
  const next = upsertFolder(opts.list, opts.draft);
  if (next === opts.list) return false;
  try {
    await opts.save({ folders: { [opts.orgId]: next } });
    return true;
  } catch {
    return false;
  }
}

export interface FolderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the folder being edited, or null to make a new one */
  folder: ChatFolderDef | null;
  /** the chats to tick when a new folder opens (the row menu's «مجلد جديد…» hands the chat it was opened from) */
  initialChatIds?: readonly string[];
  /** the company's folders (a new id must be free; the tenth is the last) */
  list: ChatFolderDef[];
  /** what the picker may offer (`pickableChats`) */
  chats: readonly ChatRowDto[];
  chatsLoaded?: boolean;
  /** saves the draft: true when it is kept. The sheet closes on true and says so on false. */
  onSave: (draft: ChatFolderDef) => Promise<boolean>;
  /** draw in place instead of on <body> (server-render tests) */
  portal?: boolean;
}

function SheetForm({ folder, initialChatIds, list, chats, chatsLoaded, onSave, onOpenChange }: Omit<FolderSheetProps, "open" | "portal">) {
  const isNew = folder === null;
  const [draft, setDraft] = useState<ChatFolderDef>(
    () => folder ?? { id: newFolderId(new Set(list.map((f) => f.id))), name: "", include: { conversationIds: [...(initialChatIds ?? [])], spaceIds: [] }, exclude: { archived: true } },
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const full = isNew && list.length >= MAX_FOLDERS;
  const canSave = !busy && !full && cleanFolderName(draft.name) !== null;

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setFailed(false);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) onOpenChange(false);
    else setFailed(true);
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{ct(isNew ? "chatfolders.sheet_new" : "chatfolders.sheet_edit")}</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <FolderForm draft={draft} onChange={setDraft} chats={chats} chatsLoaded={chatsLoaded ?? true} disabled={busy} liveName autoFocusName={isNew} pickerClassName="max-h-[40dvh]" />
      </SheetBody>
      <SheetFooter>
        {full ? <p className="me-auto text-xs text-fg-muted">{ct("chatfolders.add_full")}</p> : null}
        {failed ? (
          <p role="alert" className="me-auto text-xs text-danger">
            {ct("chatfolders.failed")}
          </p>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {ct("chatfolders.cancel")}
        </Button>
        <Button type="button" data-folder-save="" disabled={!canSave} onClick={() => void submit()}>
          {ct(busy ? "chatfolders.saving" : "chatfolders.save")}
        </Button>
      </SheetFooter>
    </>
  );
}

export function FolderSheet({ open, onOpenChange, portal, ...rest }: FolderSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent portal={portal} data-folder-sheet="" aria-describedby={undefined}>
        <SheetForm {...rest} onOpenChange={onOpenChange} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The sheet wired to the person's prefs and the chat list: new (no `folderId`) or editing one folder. Nothing while the company's switch `chatFolders` is off or
 * the prefs have not come; a `folderId` that no longer exists draws nothing. The picker's chats are read only while it is open.
 */
export function FolderSheetConnected({ open, onOpenChange, folderId = null, initialChatIds }: { open: boolean; onOpenChange: (open: boolean) => void; folderId?: string | null; initialChatIds?: readonly string[] }) {
  const prefs = useChatPrefs();
  const save = useSaveChatPrefs();
  const toast = useOptionalToast();
  const { chats, loaded } = useFolderChats(open);
  const folder = folderId ? (prefs.folders.find((f) => f.id === folderId) ?? null) : null;
  if (!prefs.foldersOn || !prefs.orgId || (folderId && !folder)) return null;
  const orgId = prefs.orgId;
  return (
    <FolderSheet
      open={open}
      onOpenChange={onOpenChange}
      folder={folder}
      {...(initialChatIds ? { initialChatIds } : {})}
      list={prefs.folders}
      chats={chats}
      chatsLoaded={loaded}
      onSave={async (draft) => {
        const ok = await saveFolderDraft({ save, orgId, list: prefs.folders, draft });
        if (ok) toast?.toast(ct("chatfolders.saved_toast"), "success");
        return ok;
      }}
    />
  );
}
