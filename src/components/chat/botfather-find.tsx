"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { BotFatherRow } from "@/components/chat/botfather-row";
import { apiGet } from "@/lib/api-client";

/**
 * «بوت فاذر» found by the chat list's search, as Telegram finds @BotFather: asked only while the words look for it, and drawn only when the directory says it is offered
 * to me (the owner and the admins, its switch on).
 */
export function BotFatherFound({ onPick }: { onPick: () => void }) {
  const { data } = useQuery({ queryKey: ["botfather-offered"], queryFn: () => apiGet<{ botFather?: boolean }>("/api/chat/directory"), staleTime: 60_000 });
  return data?.botFather ? <BotFatherRow onOpened={onPick} className="border-b border-border" /> : null;
}
