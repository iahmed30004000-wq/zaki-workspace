"use client";

import { AR } from "@/lib/i18n/dict";
import { ct } from "@/lib/chat/text";

/** What GET /api/calls/[id] answers (src/server/calls/calls.ts `CallDto`). */
export interface CallView {
  id: string;
  title: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  spaceId: string | null;
  video: boolean;
  startedAt: string;
  endedAt: string | null;
  startedBy: { id: string; name: string; avatarUrl?: string | null };
  path: string;
  people: { userId: string; name: string; canRemove: boolean; canMute: boolean; avatarUrl?: string | null }[];
  can: { invite: boolean; end: boolean };
  assistant?: { available: boolean; present: boolean };
}

/** The Arabic of an error key the server answered (`calls.e.*`), or the generic «ما زبطت». */
export function callErrorText(key: unknown): string {
  return typeof key === "string" && AR[key] ? (AR[key] as string) : ct("calls.action_failed");
}

/** One call to the calls API: JSON in, JSON out, an Arabic Error on a refusal. */
export async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
  if (!res.ok) throw new Error(callErrorText(data?.message));
  return data as T;
}
