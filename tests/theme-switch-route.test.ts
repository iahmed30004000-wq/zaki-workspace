import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The merge and the refusals of POST /api/me/switch, against a fake database (the real one is
 * tests/db/theme-switch-route.test.ts, run by CI). A request carries only what moved; what is
 * written is the four stored values and nothing else.
 */
const { rows, update } = vi.hoisted(() => {
  const rows = new Map<string, { themeSwitch: string | null }>();
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: { themeSwitch: string } }) => {
    rows.set(where.id, { themeSwitch: data.themeSwitch });
  });
  return { rows, update };
});

vi.mock("@/server/db", () => ({
  db: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? { themeSwitch: null },
      update,
    },
  },
}));
vi.mock("@/server/auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth")>("@/server/auth");
  return { ...actual, requireUser: async () => ({ id: "u1" }) };
});

import { POST } from "@/app/api/me/switch/route";

const send = (body: unknown) => POST(new Request("http://localhost/api/me/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const cookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("zk-switch="));

beforeEach(() => {
  rows.clear();
  update.mockClear();
});

describe("POST /api/me/switch", () => {
  it("saves one value over the defaults and sets the year-long cookie", async () => {
    const res = await send({ style: "lamp" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pref: { style: "lamp", brightness: 100, warmth: 0, dark: "night" } });
    expect(rows.get("u1")?.themeSwitch).toBe("lamp.100.0.night");
    expect(cookie(res)).toMatch(/^zk-switch=lamp\.100\.0\.night;/);
    expect(cookie(res)).toContain("Max-Age=31536000");
  });

  it("merges into what is stored, so a drag sends only its number", async () => {
    rows.set("u1", { themeSwitch: "warmth.100.0.islamic-epic" });
    const res = await send({ warmth: 35 });
    expect(await res.json()).toEqual({ ok: true, pref: { style: "warmth", brightness: 100, warmth: 35, dark: "islamic-epic" } });
    expect(rows.get("u1")?.themeSwitch).toBe("warmth.100.35.islamic-epic");
  });

  it("repairs a broken stored value instead of failing on it", async () => {
    rows.set("u1", { themeSwitch: "<script>" });
    const res = await send({ brightness: 60 });
    expect(res.status).toBe(200);
    expect(rows.get("u1")?.themeSwitch).toBe("plain.60.0.night");
  });

  it("refuses an empty body, an unknown key, a bad style, out-of-range numbers and a light theme as the dark one — and writes nothing", async () => {
    for (const body of [{}, { extra: 1 }, { style: "neon" }, { brightness: 39 }, { brightness: 101 }, { brightness: 70.5 }, { warmth: 101 }, { warmth: -101 }, { warmth: "5" }, { dark: "day" }, { dark: "nope" }]) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(cookie(res)).toBeUndefined();
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts each dark theme as the one to come back to", async () => {
    for (const dark of ["night", "islamic-epic", "neon-coast"]) expect((await send({ dark })).status, dark).toBe(200);
  });
});
