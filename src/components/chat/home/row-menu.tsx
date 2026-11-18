"use client";

import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { ct } from "@/lib/chat/text";

/**
 * «⋯» next to a topic or a chat of the list (the owner's ask, 2026-10-26: «3 نقط جنب المحادثة او التوبك فيها التثبيت
 * الحذف»). A space's manager pins, archives and deletes an empty topic; the OWNER also deletes any topic or chat for
 * good, messages and all («حذف نهائي», after one clear confirmation). What a person may not do is not offered; the
 * server decides again. Behind «قائمة المحادثة» in «الميزات».
 *
 * C2.2: the logic lives in four small pieces (`rowMenuOffers`, `useRowCall`, `RowMenuItems`, `PurgeConfirm`) so the new list's menu
 * (`src/components/chat/v2/row-menu.tsx`) offers EXACTLY the same items with the same calls and the same confirmation, instead of a copy
 * that could drift. `RowMenu` itself, the old screen's «⋯», draws and behaves as it always did.
 */

export type RowAction = "pin" | "archive" | "delete" | "purge";

export interface RowMenuTarget {
  kind: "topic" | "dm";
  archived?: boolean;
  system?: boolean;
  canModerate?: boolean;
  canPurge?: boolean;
}

/** Which items this row offers: the managers' ones for a topic, the owner's «حذف نهائي» for anything that is not a system topic. */
export function rowMenuOffers(t: RowMenuTarget): { manage: boolean; purge: boolean; pin: boolean; archive: boolean; delete: boolean; any: boolean } {
  const manage = t.kind === "topic" && t.canModerate === true;
  const purge = t.canPurge === true && !t.system;
  return {
    manage,
    purge,
    pin: manage && !t.archived,
    archive: manage && !t.system,
    delete: manage && !t.system && !purge,
    any: manage || purge,
  };
}

/** The one place a menu item talks to the server: shows the toast, tells `onChanged` what happened, never throws. */
export function useRowCall(onChanged: (action: RowAction) => void) {
  const toast = useOptionalToast();
  const [busy, setBusy] = useState(false);
  const say = (key: string, tone: "success" | "error" = "success") => toast?.toast(ct(key), tone);
  async function call(action: RowAction, path: string, method: string, body?: unknown, done = "chath.menu.done"): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        say(data.message === "chat.topic_has_messages" ? "chath.menu.has_messages" : (data.message ?? "chath.menu.failed"), "error");
        return false;
      }
      say(done);
      onChanged(action);
      return true;
    } catch {
      say("chath.menu.failed", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, call };
}

export interface RowMenuItemsProps extends RowMenuTarget {
  id: string;
  pinned?: boolean;
  call: ReturnType<typeof useRowCall>["call"];
  onPurge: () => void;
}

/** The items themselves (inside any `DropdownMenuContent`): pin for everybody, archive the topic, delete an empty one, and the owner's purge. */
export function RowMenuItems({ id, pinned = false, archived = false, system = false, canModerate = false, canPurge = false, kind, call, onPurge }: RowMenuItemsProps) {
  const offers = rowMenuOffers({ kind, archived, system, canModerate, canPurge });
  const topic = `/api/chat/topics/${encodeURIComponent(id)}`;
  return (
    <>
      {offers.pin ? (
        <DropdownMenuItem onSelect={() => void call("pin", topic, "PATCH", { pinned: !pinned })}>
          <span aria-hidden="true">📌</span> {pinned ? ct("chatc.topic.unpin") : ct("chatc.topic.pin")}
        </DropdownMenuItem>
      ) : null}
      {offers.archive ? (
        <DropdownMenuItem onSelect={() => void call("archive", topic, "PATCH", { archived: !archived })}>
          <span aria-hidden="true">🗄️</span> {archived ? ct("chatc.topic.unarchive") : ct("chatc.topic.archive")}
        </DropdownMenuItem>
      ) : null}
      {offers.delete ? (
        <DropdownMenuItem tone="danger" onSelect={() => void call("delete", topic, "DELETE", undefined, "chath.menu.deleted")}>
          <span aria-hidden="true">🗑️</span> {ct("chatc.topic.delete")}
        </DropdownMenuItem>
      ) : null}
      {offers.purge ? (
        <DropdownMenuItem tone="danger" onSelect={onPurge}>
          <span aria-hidden="true">🗑️</span> {ct("chath.menu.purge")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** The owner's «حذف نهائي» confirmation: one clear sentence, then the purge route. Unchanged wording and call. */
export function PurgeConfirm({
  open,
  id,
  title,
  busy,
  call,
  onClose,
}: {
  open: boolean;
  id: string;
  title: string;
  busy: boolean;
  call: ReturnType<typeof useRowCall>["call"];
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={ct("chath.menu.purge_title", { title })} onClose={onClose}>
      <p className="text-sm leading-6">{ct("chath.menu.purge_body")}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {ct("chath.menu.cancel")}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={busy}
          onClick={() =>
            void call("purge", `/api/chat/conversations/${encodeURIComponent(id)}/purge`, "POST", undefined, "chath.menu.deleted").then((ok) => {
              if (ok) onClose();
            })
          }
        >
          {ct("chath.menu.purge_confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function RowMenu({
  id,
  title,
  kind,
  pinned = false,
  archived = false,
  system = false,
  canModerate = false,
  canPurge = false,
  onChanged,
}: {
  id: string;
  title: string;
  kind: "topic" | "dm";
  pinned?: boolean;
  archived?: boolean;
  system?: boolean;
  canModerate?: boolean;
  canPurge?: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, call } = useRowCall(() => onChanged());
  if (!rowMenuOffers({ kind, archived, system, canModerate, canPurge }).any) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ct("chath.menu.open", { title })}
            disabled={busy}
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RowMenuItems id={id} kind={kind} pinned={pinned} archived={archived} system={system} canModerate={canModerate} canPurge={canPurge} call={call} onPurge={() => setConfirming(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <PurgeConfirm open={confirming} id={id} title={title} busy={busy} call={call} onClose={() => setConfirming(false)} />
    </>
  );
}
