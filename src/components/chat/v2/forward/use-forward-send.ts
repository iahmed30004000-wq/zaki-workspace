"use client";

import React from "react";
import { useOptionalToast } from "@/components/ui/toast";
import { useOpenChat } from "@/components/chat/v2/forward/use-open-chat";
import { forwardBody, outcomeOf, remainingPicks, SAVED_NEW_ID, type ForwardOutcome, type ForwardResult } from "@/lib/chat/forward";
import { ct } from "@/lib/chat/text";
import { openSavedId } from "@/lib/chat/v2/menu/menu-context";

export interface ForwardSendInput {
  messageIds: readonly string[];
  /** the picked targets (the saved chat may still be `SAVED_NEW_ID`: it is made by the dm door here) */
  picked: readonly string[];
  /** a target's id → its name, for the toast's «تحوّلت إلى …» */
  names: Readonly<Record<string, string>>;
  withoutAuthor: boolean;
  comment: string;
}

/** The outcome plus the picks that did not get their copies (what a retry after a partial answer sends to). */
export type ForwardSendOutcome = ForwardOutcome & { remaining: string[] };

/**
 * S5.2 — THE send of the forward sheet, the same for the single «حوّل» and for «حدّد» then «حوّل»: it makes my saved chat first if it is among the targets, posts ONE body to
 * `POST /api/chat/messages/forward` (the server checks every target and message again and answers per target) and says what happened in a toast — with «افتح» when exactly one
 * target was asked and it worked, so the person lands in the conversation the message went to. It never throws: a failure is a toast and the `none` outcome (the sheet stays open).
 */
export function useForwardSend(): { send: (input: ForwardSendInput) => Promise<ForwardSendOutcome>; sending: boolean } {
  const toast = useOptionalToast();
  const openChat = useOpenChat();
  const [sending, setSending] = React.useState(false);
  const send = React.useCallback(
    async (input: ForwardSendInput): Promise<ForwardSendOutcome> => {
      const say = (text: string, kind: "success" | "error", action?: { label: string; onClick: () => void }) => toast?.toast(text, kind, action);
      setSending(true);
      try {
        const names: Record<string, string> = { ...input.names };
        let targetIds = [...input.picked];
        let savedMade: string | null = null;
        if (targetIds.includes(SAVED_NEW_ID)) {
          const savedId = await openSavedId();
          if (!savedId) {
            say(ct("chatfwd.saved_failed"), "error");
            return { ...outcomeOf(null), remaining: [...input.picked] };
          }
          savedMade = savedId;
          names[savedId] = names[SAVED_NEW_ID] ?? "";
          targetIds = targetIds.map((id) => (id === SAVED_NEW_ID ? savedId : id));
        }
        let results: ForwardResult[] | null = null;
        try {
          const res = await fetch("/api/chat/messages/forward", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(forwardBody({ messageIds: input.messageIds, targetIds, withoutAuthor: input.withoutAuthor, comment: input.comment })),
          });
          if (res.ok) results = ((await res.json()) as { results?: ForwardResult[] }).results ?? null;
        } catch {
          results = null;
        }
        const outcome = outcomeOf(results);
        if (outcome.state === "none") say(ct("chatfwd.failed"), "error");
        else if (outcome.state === "some") say(ct("chatfwd.done_some", { ok: outcome.ok.length, total: outcome.ok.length + outcome.failed }), "error");
        else if (outcome.openId) {
          const target = outcome.openId;
          say(ct("chatfwd.done_to", { name: names[target] ?? "" }), "success", { label: ct("chatfwd.open"), onClick: () => openChat(target) });
        } else say(ct("chatfwd.done_all"), "success");
        return { ...outcome, remaining: remainingPicks(input.picked, outcome.ok, savedMade) };
      } finally {
        setSending(false);
      }
    },
    [toast, openChat],
  );
  return { send, sending };
}
