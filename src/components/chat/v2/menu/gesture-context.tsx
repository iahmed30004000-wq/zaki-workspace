"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";

/**
 * C2.6 — what a bubble's own gestures call. The menu host provides it (ONE object for the life of the pane: it holds the commands only), the bubble reads
 * it and does nothing when there is none (a read-only embed, a test). The registry decides whether the person may reply, so a double click never opens a
 * door the menu would not offer.
 */
export interface BubbleGestures {
  /** a double click on a message (the computer): starts a reply when the registry offers «رد» for this person on this message */
  reply: (message: MessageDto, facts: BubbleFacts) => void;
}

export const BubbleGesturesContext = React.createContext<BubbleGestures | null>(null);

export function useBubbleGestures(): BubbleGestures | null {
  return React.useContext(BubbleGesturesContext);
}
