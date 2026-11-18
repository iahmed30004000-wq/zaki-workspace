/**
 * C1.8 — the send answers right after the transaction COMMITS. The notification and the push of a message (and the company's
 * auto-ticket rules) run after the answer, so the sender's ✓ never waits for them; a failure there is still logged with
 * `log.error` (never swallowed) and never fails the send.
 *
 * In this suite every other chat test keeps the old order (the work finishes inside the call: `afterSendMode` is «inline» under
 * test unless a test asks for «deferred»), so what they check about bells and tickets is unchanged. These tests ask for the deferred
 * mode, which is what production runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ run: null as ((...args: unknown[]) => Promise<unknown>) | null, real: null as ((...args: unknown[]) => Promise<unknown>) | null }));

vi.mock("@/server/notify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/notify")>();
  hook.real = mod.pushNotification as unknown as (...args: unknown[]) => Promise<unknown>;
  return { ...mod, pushNotification: (...args: unknown[]) => (hook.run ? hook.run(...args) : hook.real!(...args)) };
});

import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { log } from "@/server/log";
import { setAfterSendModeForTests, settleAfterSendForTests } from "@/server/chat/messages";
import { resetHubForTests } from "@/server/realtime/hub";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  hook.run = null;
});
afterEach(async () => {
  hook.run = null;
  await settleAfterSendForTests();
  setAfterSendModeForTests(null);
  vi.restoreAllMocks();
});

async function world() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
  await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }]);
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { t, a, b, dm };
}
const bells = (userId: string) => db.notification.count({ where: { userId, type: "chat_message" } });
const say = (dm: string, body: string, clientId?: string) =>
  call(messagesRoute.POST, { method: "POST", params: { id: dm }, body: { body, ...(clientId ? { clientId } : {}) } });

describe("C1.8: the answer does not wait for the notification", () => {
  it("the 201 comes back while the notification step is still blocked; the bell appears once it is released", async () => {
    const w = await world();
    setAfterSendModeForTests("deferred");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let entered = false;
    hook.run = async (...args) => {
      entered = true;
      await gate;
      return hook.real!(...args);
    };
    const res = await say(w.dm, "قبل الإشعار");
    expect(res.status).toBe(201);
    // the message is stored and the answer is whole: the sender's screen has everything it needs for the ✓
    expect(res.json?.["body"]).toBe("قبل الإشعار");
    expect(res.json?.["status"]).toBe("sent");
    expect(await db.chatMessage.count({ where: { conversationId: w.dm } })).toBe(1);
    // …and the notification has NOT been made yet (it is behind the gate, after the answer)
    expect(await bells(w.b.id)).toBe(0);
    release();
    await settleAfterSendForTests();
    expect(entered).toBe(true);
    expect(await bells(w.b.id)).toBe(1);
  });

  it("a notification that fails is logged with log.error and the send is still a 201 (never swallowed, never fatal)", async () => {
    const w = await world();
    setAfterSendModeForTests("deferred");
    const errors = vi.spyOn(log, "error").mockImplementation(() => undefined);
    hook.run = async () => {
      throw new Error("push is down");
    };
    const res = await say(w.dm, "الإشعار بيفشل");
    expect(res.status).toBe(201);
    await settleAfterSendForTests();
    const logged = errors.mock.calls.filter(([event]) => event === "chat.after_send_failed");
    expect(logged).toHaveLength(1);
    expect(logged[0]![1]).toMatchObject({ step: "notify", name: "Error" });
    // the text of the message and of the error never go to the log
    expect(JSON.stringify(logged)).not.toContain("الإشعار بيفشل");
    expect(JSON.stringify(logged)).not.toContain("push is down");
    expect(await db.chatMessage.count({ where: { conversationId: w.dm } })).toBe(1);
    expect(await bells(w.b.id)).toBe(0);
  });

  it("a retry of a message already sent notifies nobody again", async () => {
    const w = await world();
    setAfterSendModeForTests("deferred");
    expect((await say(w.dm, "مرة وحدة", "c18-once")).status).toBe(201);
    await settleAfterSendForTests();
    expect(await bells(w.b.id)).toBe(1);
    expect((await say(w.dm, "مرة وحدة", "c18-once")).status).toBeLessThan(300);
    await settleAfterSendForTests();
    expect(await bells(w.b.id)).toBe(1);
  });

  it("under test the default is the old order: the bell exists when the call returns (the other chat suites rely on it)", async () => {
    const w = await world();
    expect((await say(w.dm, "بدون وضع")).status).toBe(201);
    expect(await bells(w.b.id)).toBe(1);
  });
});

describe("C1.8: the awaited work of a send (time to ✓ on localhost)", () => {
  async function timeSends(dm: string, mode: "inline" | "deferred", tag: string): Promise<number[]> {
    setAfterSendModeForTests(mode);
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const res = await say(dm, `رسالة ${tag} ${i}`, `time-${tag}-${i}`);
      times.push(performance.now() - t0);
      expect(res.status).toBe(201);
      await settleAfterSendForTests();
    }
    return times.sort((x, y) => x - y);
  }
  const median = (xs: number[]) => xs[Math.floor(xs.length / 2)]!;

  it("records the route's own time before (the work inside the call) and after (the work behind the answer), and the answer is not slower", async () => {
    const w = await world();
    // warm the connection and the module graph once
    setAfterSendModeForTests("deferred");
    await say(w.dm, "تسخين", "warm-0");
    await settleAfterSendForTests();
    const before = await timeSends(w.dm, "inline", "a");
    const after = await timeSends(w.dm, "deferred", "b");
    console.info(
      `[C1.8] send route awaited work, 7 sends each on a shared machine: inline (the old order) median ${median(before).toFixed(0)} ms (min ${before[0]!.toFixed(0)}, max ${before[6]!.toFixed(0)}); ` +
        `deferred (the answer right after the commit) median ${median(after).toFixed(0)} ms (min ${after[0]!.toFixed(0)}, max ${after[6]!.toFixed(0)})`,
    );
    // a loose ceiling, and «not slower than the old order» with room for noise: the numbers above are what the PR records
    expect(median(after)).toBeLessThan(2000);
    expect(median(after)).toBeLessThanOrEqual(median(before) * 1.5 + 30);
  });
});
