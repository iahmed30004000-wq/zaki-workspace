/**
 * The timing of the live stream, in one place so a test can shorten it (a route file may export nothing but its handlers).
 * The heartbeat is a real `ping` frame every 25 s: browsers never surface an SSE comment, so only an event lets the page notice
 * that a half-open connection went silent (F0.3). The same tick re-checks the session.
 */
const DEFAULT_HEARTBEAT_MS = 25_000;
let heartbeatMs = DEFAULT_HEARTBEAT_MS;

export function heartbeatInterval(): number {
  return heartbeatMs;
}

/** Test hook: shorten (or restore, with no argument) the heartbeat. Never call from server code. */
export function setHeartbeatMsForTests(ms?: number): void {
  heartbeatMs = ms ?? DEFAULT_HEARTBEAT_MS;
}
