/**
 * THE LIVE LINES OF THE ANDROID APPS. Each connected app holds one open line (/api/device/stream); what the server wants a phone to
 * show NOW (a ring, a notification) is written to the lines of the person. In memory on purpose: a line is only alive while its
 * connection is, and a phone that is not connected is reached by the browser's Web Push as before (src/server/calls/push.ts).
 * Kept on globalThis because Next bundles routes separately: every bundle must see the same lines.
 */
export interface DeviceEvent {
  /** «ring»: somebody is ringing; «missed»: nobody answered; «note»: one of the bell's notifications */
  kind: "ring" | "missed" | "note";
  title: string;
  body: string;
  /** the page a tap opens (a path of this site) */
  url: string;
  /** one notification per call: a second ring replaces the first */
  tag: string;
}

type Send = (event: DeviceEvent) => void;
interface Line {
  deviceId: string;
  send: Send;
}

const KEY = Symbol.for("zaki.device.lines");
const g = globalThis as unknown as Record<symbol, Map<string, Set<Line>> | undefined>;
const lines: Map<string, Set<Line>> = (g[KEY] ??= new Map());

/** A phone connected: its line is open until the returned function is called (the connection closed). */
export function openLine(userId: string, deviceId: string, send: Send): () => void {
  const line: Line = { deviceId, send };
  let set = lines.get(userId);
  if (!set) lines.set(userId, (set = new Set()));
  set.add(line);
  return () => {
    const current = lines.get(userId);
    if (!current) return;
    current.delete(line);
    if (current.size === 0) lines.delete(userId);
  };
}

/** Whether this person has at least one phone connected right now. */
export function hasLine(userId: string): boolean {
  return (lines.get(userId)?.size ?? 0) > 0;
}

/** Writes the event to every open line of these people; returns the people who had one (the browsers of THEIR phone stay quiet). */
export function deliverToDevices(userIds: readonly string[], event: DeviceEvent): Set<string> {
  const reached = new Set<string>();
  for (const id of userIds) {
    const set = lines.get(id);
    if (!set || set.size === 0) continue;
    for (const line of [...set]) {
      try {
        line.send(event);
        reached.add(id);
      } catch {
        set.delete(line);
      }
    }
  }
  return reached;
}

/** Test hook: forget every line (never call from server code). */
export function resetLinesForTests(): void {
  lines.clear();
}
