/**
 * C1.3 — `presence.changed` over the real stream (GET /api/rt), read like a browser reads it.
 *
 * The hub sends it when a person's FIRST stream opens and (after a short grace) when the LAST one closes. It is a nudge that carries
 * no id and no person: the page asks `/api/presence` again, where the roster's own rules (space, guests, the owner who hides himself)
 * apply. It is stream-only like `typing`: not a stored row, not in REALTIME_KINDS, never replayed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, loginAs, makeTeam } from "./helpers";
import * as rtRoute from "@/app/api/rt/route";
import { withFeature } from "@/lib/features";
import { resetHubForTests } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { stopRealtimeListenerForTests } from "@/server/realtime/listener";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
});
afterEach(async () => {
  resetHubForTests();
  await stopRealtimeListenerForTests();
});

async function open(userId: string, headers: Record<string, string> = {}) {
  await loginAs(userId);
  const res = await rtRoute.GET(new NextRequest("http://localhost/api/rt", { headers }));
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  async function read(until: (text: string) => boolean, ms = 3000): Promise<void> {
    const stop = Date.now() + ms;
    while (!ended && !until(text) && Date.now() < stop) {
      const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      if (next === null) continue;
      if (next.done) {
        ended = true;
        break;
      }
      text += decoder.decode(next.value);
    }
  }
  return { read, text: () => text, cancel: () => reader.cancel().catch(() => undefined) };
}

describe("presence.changed", () => {
  it("a colleague's first stream nudges the people who may see the roster, as a frame with no id and no person", async () => {
    const t = await makeTeam();
    const watcher = await open(t.member.id);
    await watcher.read((x) => x.includes(": connected"));
    const colleague = await open(t.admin.id);
    await watcher.read((x) => x.includes("presence.changed"));
    expect(watcher.text()).toContain(`data: ${JSON.stringify({ kind: "presence.changed" })}\n\n`);
    const frame = watcher.text().split("\n\n").find((f) => f.includes("presence.changed"))!;
    expect(frame).not.toContain("id:");
    expect(frame).not.toContain(t.admin.id);
    await colleague.cancel();
    await watcher.cancel();
  });

  it("a guest is never nudged (the roster is the staff directory)", async () => {
    const t = await makeTeam();
    const guest = await open(t.guest.id);
    await guest.read((x) => x.includes(": connected"));
    const colleague = await open(t.member.id);
    await guest.read((x) => x.includes("presence.changed"), 700);
    expect(guest.text()).not.toContain("presence.changed");
    await colleague.cancel();
    await guest.cancel();
  });

  it("a person without the staff directory is never nudged", async () => {
    const t = await makeTeam();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } }, data: { revokedCapabilities: ["directory.view"] } });
    const watcher = await open(t.member.id);
    await watcher.read((x) => x.includes(": connected"));
    const colleague = await open(t.admin.id);
    await watcher.read((x) => x.includes("presence.changed"), 700);
    expect(watcher.text()).not.toContain("presence.changed");
    await colleague.cancel();
    await watcher.cancel();
  });

  it("is never replayed: it is not a stored row, and a reconnect with a last event id gets none", async () => {
    const t = await makeTeam();
    const first = await open(t.admin.id);
    await first.read((x) => x.includes(": connected"));
    const before = await db.realtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    expect(await db.realtimeEvent.count({ where: { kind: "presence.changed" } })).toBe(0);
    const again = await open(t.member.id, { "last-event-id": String(before?.id ?? 0n) });
    await again.read((x) => !x.includes("retry") || x.length > 40, 500);
    expect(again.text()).not.toContain("presence.changed");
    await first.cancel();
    await again.cancel();
  });

  it("an owner who does NOT hide himself nudges like anybody (the control of the next case)", async () => {
    const t = await makeTeam();
    const watcher = await open(t.member.id);
    await watcher.read((x) => x.includes(": connected"));
    const owner = await open(t.owner.id);
    await watcher.read((x) => x.includes("presence.changed"));
    expect(watcher.text()).toContain("presence.changed");
    await owner.cancel();
    await watcher.cancel();
  });

  it("an owner who hides himself nudges nobody when he opens a stream", async () => {
    const t = await makeTeam();
    await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature({}, "ownerHiddenOnline", true) as never } });
    const watcher = await open(t.member.id);
    await watcher.read((x) => x.includes(": connected"));
    const owner = await open(t.owner.id);
    await watcher.read((x) => x.includes("presence.changed"), 700);
    expect(watcher.text()).not.toContain("presence.changed");
    await owner.cancel();
    await watcher.cancel();
  });
});
