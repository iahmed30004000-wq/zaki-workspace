"use client";

import React from "react";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";

/**
 * C2.2 — the phone's «رسالة جديدة» round button, at the bottom END of the list screen (the left corner in this right-to-left layout), above the home
 * indicator. It is the button set's own `fab` (D1: a screen does not invent its own accent button). The computer has the pencil in the list header
 * instead, so this is hidden from `md`.
 */
export function NewMessageFab({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="fab"
      aria-label={ct("chath.new_dm")}
      data-chat-fab=""
      onClick={onClick}
      className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 z-20 md:hidden"
    >
      <SquarePen className="size-6" aria-hidden="true" />
    </Button>
  );
}
