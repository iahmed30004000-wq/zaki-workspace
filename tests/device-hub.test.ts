import { beforeEach, describe, expect, it } from "vitest";
import { deliverToDevices, hasLine, openLine, resetLinesForTests, type DeviceEvent } from "@/server/devices/hub";
import { bearerOf } from "@/server/devices/devices";

/** The live lines of the Android apps: what reaches a connected phone, and nothing else. */
const ring: DeviceEvent = { kind: "ring", title: "فلان عم يرنّ عليك", body: "", url: "/calls/abc", tag: "call:abc" };

beforeEach(() => resetLinesForTests());

describe("the live lines", () => {
  it("writes an event to every open line of the person, and only to theirs", () => {
    const a: DeviceEvent[] = [];
    const b: DeviceEvent[] = [];
    const other: DeviceEvent[] = [];
    openLine("u1", "d1", (e) => a.push(e));
    openLine("u1", "d2", (e) => b.push(e));
    openLine("u2", "d3", (e) => other.push(e));
    const reached = deliverToDevices(["u1"], ring);
    expect([...reached]).toEqual(["u1"]);
    expect(a).toEqual([ring]);
    expect(b).toEqual([ring]);
    expect(other).toEqual([]);
  });

  it("a person with no line is not reached, so the browser's Web Push goes on for them", () => {
    expect(deliverToDevices(["nobody"], ring).size).toBe(0);
    expect(hasLine("nobody")).toBe(false);
  });

  it("a closed line is forgotten; a line that throws is dropped and the others still get the event", () => {
    const got: DeviceEvent[] = [];
    const close = openLine("u1", "d1", (e) => got.push(e));
    openLine("u1", "d2", () => {
      throw new Error("closed");
    });
    expect([...deliverToDevices(["u1"], ring)]).toEqual(["u1"]);
    expect(got).toHaveLength(1);
    close();
    expect(hasLine("u1")).toBe(false);
    expect(deliverToDevices(["u1"], ring).size).toBe(0);
  });
});

describe("the key of a phone comes from the Authorization header only", () => {
  it("reads «Bearer zk_…» and nothing else", () => {
    expect(bearerOf("Bearer zk_abc123")).toBe("zk_abc123");
    expect(bearerOf("bearer zk_abc123")).toBe("zk_abc123");
    expect(bearerOf("Basic zk_abc123")).toBe("");
    expect(bearerOf("Bearer a b")).toBe("");
    expect(bearerOf(null)).toBe("");
  });
});
