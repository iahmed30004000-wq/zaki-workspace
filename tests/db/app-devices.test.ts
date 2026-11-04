import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as devicesRoute from "@/app/api/me/app-devices/route";
import * as deviceRoute from "@/app/api/me/app-devices/[id]/route";
import * as stream from "@/app/api/device/stream/route";
import * as featuresRoute from "@/app/api/settings/features/route";
import { setPushSenderForTests, pushTo, type PushMessage } from "@/server/calls/push";
import { openLine, resetLinesForTests, type DeviceEvent } from "@/server/devices/hub";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «اتصال تطبيق الأندرويد»: a signed-in person pairs a phone (the key is shown once, only its hash is stored), the phone keeps a live line
 * authenticated by that key, a ring or note reaches the line, and the browser of the SAME Android phone stays quiet while the line is open.
 */
const sent: { endpoint: string; message: PushMessage }[] = [];
beforeEach(() => {
  sent.length = 0;
  resetLinesForTests();
  setPushSenderForTests(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) as PushMessage });
    return { statusCode: 201 };
  });
});
afterAll(() => {
  setPushSenderForTests(null);
  resetLinesForTests();
});

const streamRequest = (token?: string) =>
  new Request("http://localhost/api/device/stream", { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("pairing a phone", () => {
  it("returns the key once and stores only its hash; the person lists and removes their own phones", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const res = await call(devicesRoute.POST, { method: "POST", body: { name: "Pixel 7" } });
    expect(res.status).toBe(200);
    const { id, token } = res.json as { id: string; token: string };
    expect(token.startsWith("zk_")).toBe(true);
    const row = await db.appDevice.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.name).toBe("Pixel 7");

    const list = await call(devicesRoute.GET);
    expect((list.json as { devices: { id: string }[] }).devices.map((d) => d.id)).toEqual([id]);
    expect(list.text).not.toContain(token);

    // somebody else cannot remove it
    await loginAs(t.admin.id);
    expect((await call(deviceRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(404);
    await loginAs(t.member.id);
    expect((await call(deviceRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(await db.appDevice.count({ where: { userId: t.member.id } })).toBe(0);
  });

  it("keeps the newest eight phones of a person", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    for (let i = 0; i < 10; i++) await call(devicesRoute.POST, { method: "POST", body: { name: `Phone ${i}` } });
    expect(await db.appDevice.count({ where: { userId: t.member.id } })).toBe(8);
  });

  it("is refused when the owner switched «اتصال تطبيق الأندرويد» off", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    expect((await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "appConnection", on: false } })).status).toBe(200);
    await loginAs(t.member.id);
    expect((await call(devicesRoute.POST, { method: "POST", body: {} })).status).toBe(404);
  });
});

describe("the live line", () => {
  it("refuses a request without a key, with a wrong key, and with a removed phone's key", async () => {
    expect((await stream.GET(streamRequest())).status).toBe(401);
    expect((await stream.GET(streamRequest("zk_nonsense"))).status).toBe(401);
    const t = await makeTeam();
    await loginAs(t.member.id);
    const { id, token } = (await call(devicesRoute.POST, { method: "POST", body: {} })).json as { id: string; token: string };
    await call(deviceRoute.DELETE, { method: "DELETE", params: { id } });
    expect((await stream.GET(streamRequest(token))).status).toBe(401);
  });

  it("opens for a paired phone as an event stream, and answers «not found» once the company switched the feature off", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const { token } = (await call(devicesRoute.POST, { method: "POST", body: {} })).json as { token: string };
    const ok = await stream.GET(streamRequest(token));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/event-stream");
    await ok.body?.cancel();

    await loginAs(t.owner.id);
    await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "appConnection", on: false } });
    expect((await stream.GET(streamRequest(token))).status).toBe(404);
  });
});

describe("what reaches the phone", () => {
  const msg: PushMessage = { kind: "ring", title: "رنّة", body: "", url: "/calls/x", tag: "call:x" };
  async function subscribe(userId: string, userAgent: string | null) {
    const endpoint = `https://push.test.local/${userId}-${Math.random().toString(36).slice(2)}`;
    await db.pushSubscription.create({ data: { userId, endpoint, p256dh: "k", auth: "a", userAgent } });
    return endpoint;
  }

  it("a connected phone gets the ring on its line, and the Android browser of the same person stays quiet; the laptop still gets Web Push", async () => {
    const t = await makeTeam();
    const androidBrowser = await subscribe(t.member.id, "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130");
    const laptop = await subscribe(t.member.id, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130");
    const got: DeviceEvent[] = [];
    openLine(t.member.id, "d1", (e) => got.push(e));
    await pushTo([t.member.id], msg);
    expect(got).toEqual([{ kind: "ring", title: "رنّة", body: "", url: "/calls/x", tag: "call:x" }]);
    expect(sent.map((s) => s.endpoint)).toEqual([laptop]);
    expect(sent.map((s) => s.endpoint)).not.toContain(androidBrowser);
  });

  it("with no line open the phone's browser is rung as before (the app is closed or not paired)", async () => {
    const t = await makeTeam();
    const androidBrowser = await subscribe(t.member.id, "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130");
    await pushTo([t.member.id], msg);
    expect(sent.map((s) => s.endpoint)).toEqual([androidBrowser]);
  });
});
