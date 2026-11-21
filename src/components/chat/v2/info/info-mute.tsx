"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { usePersonalCall, type PersonalChange } from "@/components/chat/v2/row-menu";
import { chatKeys } from "@/lib/chat/cache/keys";
import { MUTE_PRESETS, mutedUntilOf } from "@/lib/chat/row-preview";
import { ct } from "@/lib/chat/text";
import { muteOffersOf } from "@/lib/chat/v2/info/info-model";
import { useListPersonal } from "@/lib/chat/v2/info/use-info-data";

const chip = "inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/**
 * S5.4 — «كتم الإشعارات» in the info panel: the SAME five presets the chat list's menu offers (`MUTE_PRESETS`, `mutedUntilOf`), through the person's own door (`PUT
 * …/me`, by the row menu's hook, which also says «تمام» or «ما زبطت» and asks the list again). While the chat is muted the row says so and offers «رفع الكتم». The
 * header says whether it is muted (`me.muted`), so after a change the header is asked for again and the row follows. Nothing for «الرسائل المحفوظة», for a reader in
 * silent oversight, or while the company's switch is off (`muteOffersOf`).
 */
export function MuteRow({ header, saved }: { header: ConversationHeaderDto; saved: boolean }) {
  const qc = useQueryClient();
  const personal = useListPersonal();
  // the hook only needs the row's id (the unread count matters for «mark read», which this row never asks)
  const { busy, call } = usePersonalCall({ id: header.id, unread: 0 });
  const offers = muteOffersOf({ muted: header.me.muted === true, personal, saved, oversight: header.me.oversight === true });
  if (!offers) return null;

  const run = (change: PersonalChange) =>
    void call(change).then((ok) => {
      if (ok) void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
    });

  return (
    <section data-info-mute={offers.state} className="mt-2 bg-surface-1 px-4 py-3">
      {offers.state === "lift" ? (
        <div className="flex items-center gap-3">
          <BellOff aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
          <p className="min-w-0 flex-1 text-sm">{ct("chatprof.mute.muted")}</p>
          <button type="button" data-info-mute-lift="" disabled={busy} onClick={() => run({ mutedUntil: null })} className={chip}>
            {ct("chatps.unmute")}
          </button>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-3 text-sm">
            <Bell aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            {ct("chatprof.mute.label")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MUTE_PRESETS.map((preset) => (
              <button key={preset.key} type="button" data-info-mute-preset={preset.key} disabled={busy} onClick={() => run({ mutedUntil: mutedUntilOf(preset) })} className={chip}>
                {ct(preset.labelKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
