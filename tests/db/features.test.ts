import * as React from "react";
import { describe, expect, it, vi } from "vitest";

// the pages call notFound(); no running Next app is needed here
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
import * as watchRoute from "@/app/api/watch/route";
import * as sessionRoute from "@/app/api/watch/[id]/route";
import * as remoteRoute from "@/app/api/watch/[id]/remote/route";
import WatchPage from "@/app/(app)/watch/page";
import CheckinsPage from "@/app/(app)/checkins/page";
import * as checkinsTodayRoute from "@/app/api/checkins/today/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { actorFeatureOn, isFeatureOn } from "@/server/services/features";
import { FEATURES } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

// the pages are TSX: under vitest their JSX compiles to React.createElement, which needs a global React
(globalThis as { React?: typeof React }).React = React;

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const LINK = "https://youtu.be/dQw4w9WgXcQ";

async function world() {
  const t = await makeTeam();
  const colleague = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Colleague" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: colleague.id }, { userId: t.admin.id, role: "ADMIN" }]);
  return { ...t, colleague, ws };
}

async function as(userId: string, spaceId: string) {
  await loginAs(userId);
  jar().set(SPACE_COOKIE, spaceId);
}

const flip = (key: string, on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key, on } });

describe("«الميزات»: who switches", () => {
  it("every switch is listed for the company's staff at its default (all on, except «إخفاء المالك من متصل», «مساعد المالك» and «باب الربط الخارجي»: off until the owner turns them on)", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const res = await call(featuresRoute.GET);
    expect(res.status).toBe(200);
    expect(res.json?.["features"]).toEqual(FEATURES.map((key) => ({ key, on: key !== "ownerHiddenOnline" && key !== "ownerAssistant" && key !== "apiDoor" })));
    expect(await isFeatureOn(w.org.id, "watch")).toBe(true);
    // «حقول مخصصة» is listed and on by default (its doors are pinned in custom-fields.test.ts)
    expect(await isFeatureOn(w.org.id, "customFields")).toBe(true);
    expect(await isFeatureOn(w.org.id, "chatOutbox")).toBe(true); // «الرسائل بدون نت»: on until the owner turns it off
    // «طلبات الموافقة والنماذج» is on by default, and the owner alone switches it
    expect((res.json?.["features"] as { key: string; on: boolean }[]).find((f) => f.key === "approvals")).toEqual({ key: "approvals", on: true });
    expect(await isFeatureOn(w.org.id, "approvals")).toBe(true);
    // «الأداء والتطوير» is a switch of its own, on by default
    expect((res.json?.["features"] as { key: string; on: boolean }[]).find((f) => f.key === "teamDevelopment")).toEqual({ key: "teamDevelopment", on: true });
  });

  it("«آخر ظهور» is listed ON, and the owner's switch turns it off and on for his company alone", async () => {
    const w = await world();
    await as(w.owner.id, w.ws.id);
    const listed = (await call(featuresRoute.GET)).json?.["features"] as { key: string; on: boolean }[];
    expect(listed.find((f) => f.key === "lastSeen")).toEqual({ key: "lastSeen", on: true });
    expect((await flip("lastSeen", false)).status).toBe(200);
    expect(await isFeatureOn(w.org.id, "lastSeen")).toBe(false);
    expect((await flip("lastSeen", true)).status).toBe(200);
    expect(await isFeatureOn(w.org.id, "lastSeen")).toBe(true);
  });

  it("only the owner switches: an admin and a member are refused, and nothing changes", async () => {
    const w = await world();
    for (const person of [w.admin, w.member]) {
      await as(person.id, w.ws.id);
      const res = await flip("watch", false);
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"], person.name).toBe("features.owner_only");
    }
    expect(await isFeatureOn(w.org.id, "watch")).toBe(true);
  });

  it("an unknown key is refused before anything is written", async () => {
    const w = await world();
    await as(w.owner.id, w.ws.id);
    expect((await flip("nope", false)).status).toBe(422);
  });

  it("the owner's switch keeps every other setting of the company, and touches no other company", async () => {
    const w = await world();
    const other = await makeTeam();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { theme: { kept: 1 }, features: { future: true } } } });
    await as(w.owner.id, w.ws.id);
    expect((await flip("watch", false)).json).toEqual({ key: "watch", on: false });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect(org.settings).toEqual({ theme: { kept: 1 }, features: { future: true, watch: false } });
    expect(await isFeatureOn(other.org.id, "watch")).toBe(true);
  });
});

describe("«الميزات»: «نتفرّج سوا» switched off is gone, and back with everything when switched on", () => {
  it("off: its doors answer «not found» and its page is not there; on: the session is back as it was", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const id = (await call(watchRoute.POST, { body: { url: LINK, memberIds: [w.colleague.id] } })).json?.["id"] as string;

    await as(w.owner.id, w.ws.id);
    await flip("watch", false);

    await as(w.member.id, w.ws.id);
    expect(await actorFeatureOn({ orgId: w.org.id }, "watch")).toBe(false);
    for (const res of [
      await call(watchRoute.GET),
      await call(watchRoute.POST, { body: { url: LINK, memberIds: [w.colleague.id] } }),
      await call(sessionRoute.GET, { params: { id } }),
      await call(remoteRoute.GET, { params: { id } }),
      await call(remoteRoute.POST, { method: "POST", params: { id }, body: { playing: true, positionSec: 1 } }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.json?.["message"]).toBe("features.off");
    }
    await expect(WatchPage()).rejects.toThrow("NEXT_NOT_FOUND");
    // nothing was lost
    expect(await db.watchSession.count({ where: { id } })).toBe(1);
    expect(await db.watchSession.count({ where: { spaceId: w.ws.id } })).toBe(1);

    await as(w.owner.id, w.ws.id);
    await flip("watch", true);
    await as(w.member.id, w.ws.id);
    const back = await call(watchRoute.GET);
    expect(back.status).toBe(200);
    expect((back.json?.["sessions"] as { id: string }[]).map((s) => s.id)).toEqual([id]);
  });
});

describe("«الميزات»: «التسجيل اليومي» (on by default) switched off is gone, and back when switched on", () => {
  it("off: its routes answer «not found» and its page is not there; on: both answer again", async () => {
    const w = await world();
    await as(w.member.id, w.ws.id);
    const url = `http://localhost/api/checkins/today?workspaceId=${w.ws.id}`;
    expect((await call(checkinsTodayRoute.GET, { url })).status).toBe(200);
    expect(await isFeatureOn(w.org.id, "checkins")).toBe(true);

    await as(w.owner.id, w.ws.id);
    expect((await flip("checkins", false)).json).toEqual({ key: "checkins", on: false });
    await as(w.member.id, w.ws.id);
    const off = await call(checkinsTodayRoute.GET, { url });
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    await expect(CheckinsPage()).rejects.toThrow("NEXT_NOT_FOUND");

    await as(w.owner.id, w.ws.id);
    await flip("checkins", true);
    await as(w.member.id, w.ws.id);
    expect((await call(checkinsTodayRoute.GET, { url })).status).toBe(200);
    // the page draws again (it does not throw «not found»)
    await expect(CheckinsPage()).resolves.toBeTruthy();
  });
});
