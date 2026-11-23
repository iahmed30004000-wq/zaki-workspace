import { describe, expect, it } from "vitest";
import { ALL_DOOR_PERMISSIONS } from "../src/server/door/tokens";
import { DEFAULT_SYSTEM_EXPIRY_DAYS, DOOR_SYSTEMS, doorSystem } from "../src/lib/door/systems";
import { AR } from "../src/lib/i18n/dict";

/** W1: the systems that may hold a door token — fixed names, fixed scopes. */
describe("the systems of «توكنات الأنظمة»", () => {
  it("«الميديا باير» holds exactly tasks.write and tasks.read, as its contract says", () => {
    const mb = doorSystem("mediabuyer");
    expect(mb?.name).toBe("الميديا باير");
    expect([...(mb?.permissions ?? [])].sort()).toEqual(["tasks.read", "tasks.write"]);
  });
  it("every scope is one the door knows, and a name of the language itself is no system", () => {
    for (const s of DOOR_SYSTEMS) for (const p of s.permissions) expect((ALL_DOOR_PERMISSIONS as readonly string[]).includes(p), p).toBe(true);
    for (const bad of ["constructor", "__proto__", "toString", "", null, undefined, 5, "MEDIABUYER"]) expect(doorSystem(bad), String(bad)).toBeNull();
  });
  it("the default expiry is 90 days, the system has its word on the page", () => {
    expect(DEFAULT_SYSTEM_EXPIRY_DAYS).toBe(90);
    for (const s of DOOR_SYSTEMS) expect(AR[`systok.system.${s.key}`]).toBe(s.name);
    for (const s of DOOR_SYSTEMS) for (const p of s.permissions) expect(AR[`systok.perm.${p}`], p).toBeTruthy();
  });
});
