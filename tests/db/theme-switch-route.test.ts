import { beforeEach, describe, expect, it } from "vitest";
import * as switchRoute from "@/app/api/me/switch/route";
import * as loginRoute from "@/app/api/auth/login/route";
import { PREF_COOKIE_MAX_AGE } from "@/lib/themes/registry";
import { call, db, logout, loginAs, makeTeam, TEST_PASSWORD } from "./helpers";

/**
 * POST /api/me/switch — «مظهر المفتاح»: a person saves the look of their own light/dark switch. It is
 * merged into what is stored, saved on THEIR row only, set as the `zk-switch` cookie for a year, and
 * brought to a new device by the sign-in. Nothing but style, brightness, warmth and the dark theme is kept.
 */

const post = (body: unknown) => call(switchRoute.POST, { method: "POST", url: "http://localhost/api/me/switch", body });
const cookieOf = (headers: Headers) => headers.getSetCookie().find((c) => c.startsWith("zk-switch="));
const stored = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id }, select: { themeSwitch: true } })).themeSwitch;

beforeEach(() => logout());

describe("POST /api/me/switch", () => {
  it("saves a style on the caller's account and sets the cookie for a year, readable by the page", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await post({ style: "lamp" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, pref: { style: "lamp", brightness: 100, warmth: 0, dark: "night" } });
    expect(await stored(member.id)).toBe("lamp.100.0.night");
    const cookie = cookieOf(res.headers);
    expect(cookie).toMatch(/^zk-switch=lamp\.100\.0\.night;/);
    expect(cookie).toContain(`Max-Age=${PREF_COOKIE_MAX_AGE}`);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("merges: a request with one number keeps everything saved before", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await post({ style: "warmth", dark: "islamic-epic" });
    const res = await post({ warmth: -40 });
    expect(res.json).toEqual({ ok: true, pref: { style: "warmth", brightness: 100, warmth: -40, dark: "islamic-epic" } });
    expect(await stored(member.id)).toBe("warmth.100.-40.islamic-epic");
  });

  it("touches only the caller's own row", async () => {
    const { member, owner } = await makeTeam();
    await loginAs(member.id);
    await post({ style: "sky" });
    expect(await stored(owner.id)).toBeNull();
  });

  it("refuses anything out of range, unknown, a light theme as the dark one, or an empty body (422), and changes nothing", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await post({ style: "glass" });
    for (const body of [{}, { style: "neon" }, { brightness: 10 }, { brightness: 101 }, { brightness: 55.5 }, { warmth: 101 }, { warmth: -101 }, { dark: "day" }, { dark: "x" }, { style: "lamp", extra: 1 }, { warmth: "5" }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(cookieOf(res.headers)).toBeUndefined();
    }
    expect(await stored(member.id)).toBe("glass.100.0.night");
  });

  it("needs a signed-in person (401)", async () => {
    const res = await post({ style: "lamp" });
    expect(res.status).toBe(401);
  });
});

describe("sign-in brings the switch to a new device", () => {
  let n = 0;
  const signIn = (identifier: string) => {
    n += 1;
    return call(loginRoute.POST, { method: "POST", body: { identifier, password: TEST_PASSWORD }, headers: { "x-forwarded-for": `100.64.88.${n}` } });
  };

  it("a person who chose a look gets it as the zk-switch cookie; somebody who never chose gets none", async () => {
    const { member, owner } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { themeSwitch: "sky.100.0.neon-coast" } });
    const chosen = await signIn(member.email);
    expect(chosen.status).toBe(200);
    expect(cookieOf(chosen.headers)).toMatch(/^zk-switch=sky\.100\.0\.neon-coast;/);
    const never = await signIn(owner.email);
    expect(never.status).toBe(200);
    expect(cookieOf(never.headers)).toBeUndefined();
  });

  it("a broken stored value is cleaned on the way out (the default, never the raw text)", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { themeSwitch: "<script>" } });
    const res = await signIn(member.email);
    expect(cookieOf(res.headers)).toMatch(/^zk-switch=plain\.100\.0\.night;/);
  });
});
