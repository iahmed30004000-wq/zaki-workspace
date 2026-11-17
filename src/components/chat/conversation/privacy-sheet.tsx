"use client";

import React from "react";
import type { MemberDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { ct } from "@/lib/chat/text";
import type { PrivacyState } from "@/lib/chat/privacy";

/**
 * What the sheet says (P0.4): who reads this conversation, and — honestly — that the owner may read it silently when
 * `oversightNotice` is true (the server only says so when somebody outside the conversation holds `archive.view`).
 */
export function PrivacyBody({ state, members, oversightNotice }: { state: PrivacyState; members: MemberDto[]; oversightNotice: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">{ct(`chatp.sheet.${state}`)}</p>
      {state !== "open" && members.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">{ct("chatp.sheet.people")}</p>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {members.map((m) => (
              <li key={m.id} className="flex min-h-11 items-center gap-3 px-3">
                <Avatar name={m.name} src={m.avatarUrl} className="size-7 text-xs" />
                <bdi className="min-w-0 flex-1 truncate">{m.name}</bdi>
              </li>
            ))}
          </ul>
        </div>
      )}
      {oversightNotice && state !== "open" && <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">⚠️ {ct("chatp.sheet.oversight")}</p>}
    </div>
  );
}

export function PrivacySheet({
  open,
  onOpenChange,
  state,
  members,
  oversightNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PrivacyState;
  members: MemberDto[];
  oversightNotice: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chatp.sheet.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <PrivacyBody state={state} members={members} oversightNotice={oversightNotice} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
