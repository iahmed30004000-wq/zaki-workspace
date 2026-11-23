"use client";

import React, { useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { useOptionalToast } from "@/components/ui/toast";
import { customIdOf, moveFolder, removeFolder, type TabKey } from "@/lib/chat/folders";
import { MAX_FOLDERS } from "@/lib/chat/prefs";
import { ct } from "@/lib/chat/text";
import { FolderSheetConnected } from "./folder-sheet";
import { useChatPrefs, useSaveChatPrefs, type FolderStripExtras } from "./folder-tabs";

/**
 * S5.3 — folders from inside the chat, as ONE hook for the list column: it gives the strip and the column what they need (`tabProps`: the «+» at the end, and
 * the long press / right click on a tab of the person's own) and the pieces those open (`element`: the small sheet to make or edit a folder, the little menu
 * «تعديل / حذف» under the tab, and the confirmation before a delete). Nothing is offered while the company's switch `chatFolders` is off or the prefs have not
 * come: `tabProps` is empty and the strip is what it was. A delete is ONE save of the company's list; the chats in the folder are not touched.
 */
type Sheet = { kind: "new" } | { kind: "edit"; id: string };

export function useInlineFolders(): { tabProps: FolderStripExtras<TabKey>; element: ReactNode } {
  const prefs = useChatPrefs();
  const save = useSaveChatPrefs();
  const toast = useOptionalToast();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<{ id: string; box: DOMRect } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const on = prefs.foldersOn && prefs.orgId !== null;

  const tabProps: FolderStripExtras<TabKey> = on
    ? {
        onAdd: () => setSheet({ kind: "new" }),
        addDisabled: prefs.folders.length >= MAX_FOLDERS,
        onManage: (key, box) => {
          const id = customIdOf(key);
          if (id && prefs.folders.some((f) => f.id === id)) setMenu({ id, box });
        },
      }
    : {};

  const target = menu ? prefs.folders.find((f) => f.id === menu.id) : undefined;
  const doomed = confirm ? prefs.folders.find((f) => f.id === confirm) : undefined;
  const orgId = prefs.orgId;

  // «قدّمه» / «أخّره»: one place in the strip, one save of the company's list (the folders keep the person's order; the built-in tabs stay before them)
  const move = (id: string, step: -1 | 1) => {
    if (!orgId) return;
    const next = moveFolder(prefs.folders, id, step);
    if (next === prefs.folders) return;
    save({ folders: { [orgId]: next } }).then(undefined, () => toast?.toast(ct("chatfolders.failed"), "error"));
  };

  const remove = () => {
    if (!doomed || !orgId) return;
    const next = removeFolder(prefs.folders, doomed.id);
    setConfirm(null);
    save({ folders: { [orgId]: next.length > 0 ? next : null } }).then(
      () => toast?.toast(ct("chatfolders.deleted_toast"), "success"),
      () => toast?.toast(ct("chatfolders.failed"), "error"),
    );
  };

  const element = !on ? null : (
    <>
      {menu && target ? (
        <DropdownMenu open onOpenChange={(open) => !open && setMenu(null)}>
          {/* the menu hangs from the tab: an empty marker as wide as the tab, fixed where the tab is */}
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" data-folder-menu-anchor="" style={{ position: "fixed", left: menu.box.left, top: menu.box.bottom, width: menu.box.width, height: 0 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" onCloseAutoFocus={(event) => event.preventDefault()}>
            <DropdownMenuLabel>{ct("chatfolders.tab_menu", { name: target.name })}</DropdownMenuLabel>
            <DropdownMenuItem data-folder-menu-edit="" onSelect={() => setSheet({ kind: "edit", id: target.id })}>
              <Pencil aria-hidden="true" className="size-4" />
              {ct("chatfolders.menu_edit")}
            </DropdownMenuItem>
            <DropdownMenuItem data-folder-menu-earlier="" disabled={prefs.folders[0]?.id === target.id} onSelect={() => move(target.id, -1)}>
              <ChevronsRight aria-hidden="true" className="size-4" />
              {ct("chatfolders.menu_earlier")}
            </DropdownMenuItem>
            <DropdownMenuItem data-folder-menu-later="" disabled={prefs.folders[prefs.folders.length - 1]?.id === target.id} onSelect={() => move(target.id, 1)}>
              <ChevronsLeft aria-hidden="true" className="size-4" />
              {ct("chatfolders.menu_later")}
            </DropdownMenuItem>
            <DropdownMenuItem data-folder-menu-delete="" tone="danger" onSelect={() => setConfirm(target.id)}>
              <Trash2 aria-hidden="true" className="size-4" />
              {ct("chatfolders.menu_delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {sheet ? <FolderSheetConnected open onOpenChange={(open) => !open && setSheet(null)} folderId={sheet.kind === "edit" ? sheet.id : null} /> : null}
      {doomed ? (
        <Modal open title={ct("chatfolders.delete_title", { name: doomed.name })} onClose={() => setConfirm(null)}>
          <p className="text-sm leading-6">{ct("chatfolders.delete_body")}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirm(null)}>
              {ct("chatfolders.cancel")}
            </Button>
            <Button type="button" variant="danger" data-folder-delete-confirm="" onClick={remove}>
              {ct("chatfolders.delete_confirm")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );

  return { tabProps, element };
}
