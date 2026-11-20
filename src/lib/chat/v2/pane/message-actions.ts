/**
 * C2.4 — the doors a message action calls. NONE is new: each is the address and method the old screen called (`conversation-screen.tsx`), written down
 * once so the pane's actions (`pane-actions.tsx`) and the tests share them. The server decides every one again (an action the person may not take is
 * answered with a refusal, never hidden by the screen).
 */
export interface Door {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

const enc = encodeURIComponent;
const at = (id: string) => `/api/chat/messages/${enc(id)}`;

export const doors = {
  react: (messageId: string, emoji: string): Door => ({ path: `${at(messageId)}/react`, method: "POST", body: { emoji } }),
  pin: (messageId: string): Door => ({ path: `${at(messageId)}/pin`, method: "POST" }),
  remove: (messageId: string): Door => ({ path: at(messageId), method: "DELETE" }),
  /** «قرأت ✓» on a must-read message, and taking it back */
  ack: (messageId: string, on: boolean): Door => ({ path: `${at(messageId)}/ack`, method: on ? "POST" : "DELETE" }),
  mustRead: (messageId: string, on: boolean): Door => ({ path: `${at(messageId)}/must-read`, method: "POST", body: { on } }),
  /** «حدّد» then «حوّل» (C3b.5): the picked messages into up to ten conversations; the answer reports each target */
  forwardMany: (messageIds: string[], targetIds: string[], withoutAuthor: boolean): Door => ({ path: "/api/chat/messages/forward", method: "POST", body: { messageIds, targetIds, withoutAuthor } }),
  /** «حدّد» then «احذف» (C3b.5): the picked messages, each by the single rule; the answer reports each id */
  removeMany: (ids: string[]): Door => ({ path: "/api/chat/messages/delete", method: "POST", body: { ids } }),
  /** «شيل المعاينة» (C3b.2): the author takes the link card off their message */
  removePreview: (messageId: string): Door => ({ path: `${at(messageId)}/preview`, method: "DELETE" }),
  /** «شارك بالمحادثة»: the owner leaves silent oversight of an open topic */
  join: (conversationId: string): Door => ({ path: `/api/chat/conversations/${enc(conversationId)}/join`, method: "POST" }),
  /** close / reopen / archive / bring back a topic (its moderators; the route checks again) */
  topic: (conversationId: string, patch: { closed?: boolean; archived?: boolean }): Door => ({ path: `/api/chat/topics/${enc(conversationId)}`, method: "PATCH", body: patch }),
} as const;

export type DoorResult = { ok: true } | { ok: false; message: string | null };

/** One call to a door: JSON in when there is a body, `{ok}` out; a refusal carries the server's own reason key (`chat.topic_system`), a fault carries null. */
export async function callDoor(door: Door, fetchImpl: typeof fetch = fetch): Promise<DoorResult> {
  try {
    const response = await fetchImpl(door.path, {
      method: door.method,
      ...(door.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(door.body) } : {}),
    });
    if (response.ok) return { ok: true };
    const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return { ok: false, message: typeof data?.message === "string" ? data.message : null };
  } catch {
    return { ok: false, message: null };
  }
}

/** «شيل المعاينة» (C3b.2): the one call and the toast key of its answer (a refusal and a fault both say the same, the server decided). */
export async function removePreviewOf(messageId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; key: "chatlp.removed" | "chatlp.remove_failed" }> {
  const result = await callDoor(doors.removePreview(messageId), fetchImpl);
  return result.ok ? { ok: true, key: "chatlp.removed" } : { ok: false, key: "chatlp.remove_failed" };
}
