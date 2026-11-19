"use client";

import type { ConversationHeaderDto } from "@/server/chat/dto";

/**
 * C2.4 — SEAM 4: the info panel. It renders NOTHING yet; C2.7 OWNS THIS FILE AFTERWARDS (the panel of a private chat or a topic: the big picture, the
 * buttons row, the members, the media tabs of C3). The header's title only TOGGLES `infoOpen` in the pane's actions (`pane-actions.tsx`), so C2.7 reads
 * `usePaneActions().infoOpen` here and draws beside the pane (a side panel on the computer, an overlay on a tablet) — no other file of the pane changes.
 */
export function InfoHost(_props: { header: ConversationHeaderDto }) {
  return null;
}
