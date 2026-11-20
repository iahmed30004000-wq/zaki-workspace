import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import * as featuresRoute from "@/app/api/settings/features/route";
import * as checkinsTodayRoute from "@/app/api/checkins/today/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { isFeatureOn, listFeatures } from "@/server/services/features";
import { FEATURES, FEATURE_DEFAULTS, type FeatureKey } from "@/lib/features";
import { SIMPLE_MODE_OFF } from "@/lib/feature-groups";
import { call, db, loginAs, makeTeam, makeTask, makeProject, makeWorkspace } from "./helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  return { ...t, ws };
}

async function as(userId: string, spaceId: string) {
  await loginAs(userId);
  jar().set(SPACE_COOKIE, spaceId);
}

const preset = (name: string) => call(featuresRoute.POST, { method: "POST", body: { preset: name } });
const flip = (key: string, on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key, on } });
const stored = async (orgId: string) => (await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } })).settings as { features?: Record<string, boolean>; [k: string]: unknown };

describe("A1.4: the presets of «الميزات» (server)", () => {
  it("«الوضع البسيط» switches OFF exactly the ten, in one write, keeps every other setting, and answers what changed", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { theme: { kept: 1 }, features: { future: true, chatBubbles: false } } } });
    await as(w.owner.id, w.ws.id);
    const res = await preset("simple");
    expect(res.status).toBe(200);
    expect(res.json?.["preset"]).toBe("simple");
    expect((res.json?.["changed"] as { key: string; on: boolean }[]).map((c) => c.key).sort()).toEqual([...SIMPLE_MODE_OFF].sort());
    const settings = await stored(w.org.id);
    expect(settings["theme"]).toEqual({ kept: 1 });
    expect(settings.features).toEqual({ future: true, chatBubbles: false, ...Object.fromEntries(SIMPLE_MODE_OFF.map((k) => [k, false])) });
    // every other switch is as it was: the list differs from the defaults in the ten and in the hand-switched one only
    const list = await listFeatures(w.org.id);
    const differing = list.filter((f) => f.on !== FEATURE_DEFAULTS[f.key]).map((f) => f.key).sort();
    expect(differing).toEqual([...SIMPLE_MODE_OFF, "chatBubbles"].sort());
    for (const key of SIMPLE_MODE_OFF) expect(await isFeatureOn(w.org.id, key), key).toBe(false);
  });

  it("«كل شي» brings the ten back and the hand-switched one with them, and leaves the switches that start OFF alone", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { dbBackup: false, voiceTranscript: false, apiDoor: true } } } });
    await as(w.owner.id, w.ws.id);
    await preset("simple");
    await flip("chatBubbles", false);
    const res = await preset("all");
    expect(res.status).toBe(200);
    expect((res.json?.["changed"] as { key: string }[]).map((c) => c.key).sort()).toEqual([...SIMPLE_MODE_OFF, "chatBubbles"].sort());
    const list = await listFeatures(w.org.id);
    // everything that is on by default is on again
    for (const f of list.filter((x) => FEATURE_DEFAULTS[x.key])) expect(f.on, f.key).toBe(true);
    // the ones that start OFF are exactly as the owner left them: the door stays on, the model and the backup stay off
    expect(list.find((f) => f.key === "apiDoor")?.on).toBe(true);
    expect(list.find((f) => f.key === "dbBackup")?.on).toBe(false);
    expect(list.find((f) => f.key === "voiceTranscript")?.on).toBe(false);
    expect(list.find((f) => f.key === "economyMode")?.on).toBe(false);
  });

  it("switching back restores: simple then all is the company as it was, and a second press changes nothing", async () => {
    const w = await world();
    await as(w.owner.id, w.ws.id);
    const before = await listFeatures(w.org.id);
    await preset("simple");
    expect(await listFeatures(w.org.id)).not.toEqual(before);
    await preset("all");
    expect(await listFeatures(w.org.id)).toEqual(before);
    const again = await preset("all");
    expect(again.status).toBe(200);
    expect(again.json?.["changed"]).toEqual([]);
  });

  it("nothing is deleted: the data of a switched-off feature stays, and answers again when it is back", async () => {
    const w = await world();
    const p = await makeProject(w.ws.id);
    const task = await makeTask({ orgId: w.org.id, workspaceId: w.ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: w.member.id });
    const url = `http://localhost/api/checkins/today?workspaceId=${w.ws.id}`;
    await as(w.member.id, w.ws.id);
    expect((await call(checkinsTodayRoute.GET, { url })).status).toBe(200);
    const tasksBefore = await db.task.count({ where: { workspaceId: w.ws.id } });

    await as(w.owner.id, w.ws.id);
    await preset("simple");
    await as(w.member.id, w.ws.id);
    const off = await call(checkinsTodayRoute.GET, { url });
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(tasksBefore);
    expect(await db.task.findUnique({ where: { id: task.id } })).not.toBeNull();

    await as(w.owner.id, w.ws.id);
    await preset("all");
    await as(w.member.id, w.ws.id);
    expect((await call(checkinsTodayRoute.GET, { url })).status).toBe(200);
  });

  it("only the owner applies a preset: an admin and a member are refused and nothing changes (D-A4: the owner rank, as for a single switch)", async () => {
    const w = await world();
    for (const person of [w.admin, w.member]) {
      await as(person.id, w.ws.id);
      const res = await preset("simple");
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"], person.name).toBe("features.owner_only");
    }
    await as(w.guest.id, w.ws.id);
    expect((await preset("simple")).status).toBe(403);
    expect(await listFeatures(w.org.id)).toEqual(FEATURES.map((key) => ({ key, on: FEATURE_DEFAULTS[key] })));
  });

  it("an unknown preset or a list sent by the client is refused before anything is written", async () => {
    const w = await world();
    await as(w.owner.id, w.ws.id);
    expect((await preset("nope")).status).toBe(422);
    expect((await call(featuresRoute.POST, { method: "POST", body: {} })).status).toBe(422);
    // the client names the preset only: the keys are the server's
    const sneaky = await call(featuresRoute.POST, { method: "POST", body: { preset: "simple", keys: ["economyMode"] } });
    expect(sneaky.status).toBe(200);
    expect(await isFeatureOn(w.org.id, "economyMode")).toBe(false);
    expect((await stored(w.org.id)).features?.["economyMode"]).toBeUndefined();
  });

  it("touches no other company, and writes one audit line naming the preset and what changed", async () => {
    const w = await world();
    const other = await makeTeam();
    await as(w.owner.id, w.ws.id);
    await preset("simple");
    expect(await isFeatureOn(other.org.id, "okr")).toBe(true);
    const rows = await db.auditLog.findMany({ where: { orgId: w.org.id, action: "org.features_preset" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(w.owner.id);
    const meta = rows[0]?.meta as { preset: string; changed: string[] };
    expect(meta.preset).toBe("simple");
    expect([...meta.changed].sort()).toEqual([...SIMPLE_MODE_OFF].sort());
    // a press that changes nothing leaves no line
    await preset("simple");
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "org.features_preset" } })).toBe(1);
  });

  it("the single switch still works exactly as before (PATCH), and the list keeps every key", async () => {
    const w = await world();
    await as(w.owner.id, w.ws.id);
    expect((await flip("okr", false)).json).toEqual({ key: "okr", on: false });
    const list = (await call(featuresRoute.GET)).json?.["features"] as { key: FeatureKey; on: boolean }[];
    expect(list.map((f) => f.key)).toEqual([...FEATURES]);
    expect(list.find((f) => f.key === "okr")?.on).toBe(false);
  });
});
