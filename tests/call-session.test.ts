import { describe, expect, it } from "vitest";
import { insideCall, isDrop, isFresh, MAX_REJOINS, micOnAtJoin, miniVisible, PASS_FRESH_MS, REASON, rejoinDelayMs } from "@/lib/calls/session";

describe("a call stays alive while the person moves around the app", () => {
  it("the small window shows on every page but the call's own", () => {
    expect(miniVisible("/chat", "c1")).toBe(true);
    expect(miniVisible("/", "c1")).toBe(true);
    expect(miniVisible("/calls/c1", "c1")).toBe(false);
    expect(miniVisible("/chat", null)).toBe(false);
  });

  it("only a drop by the network is joined again by itself — never «اطلع», being taken out, or the call ending", () => {
    expect(isDrop(undefined)).toBe(true);
    expect(isDrop(9)).toBe(true); // the signal connection closed (the phone slept, the network changed)
    expect(isDrop(14)).toBe(true); // a connection timeout
    expect(isDrop(REASON.CLIENT_INITIATED)).toBe(false);
    expect(isDrop(REASON.PARTICIPANT_REMOVED)).toBe(false);
    expect(isDrop(REASON.ROOM_DELETED)).toBe(false);
    expect(isDrop(REASON.DUPLICATE_IDENTITY)).toBe(false);
  });

  it("quiet rejoins back off and stop", () => {
    expect([1, 2, 3, 4, 5, 6].map(rejoinDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(MAX_REJOINS).toBeGreaterThan(3);
  });

  it("a pass fetched while ringing is used only while fresh", () => {
    expect(isFresh(0, PASS_FRESH_MS - 1)).toBe(true);
    expect(isFresh(0, PASS_FRESH_MS)).toBe(false);
  });
});

describe("joining a call: who enters with the microphone on, and who already is inside", () => {
  it("only a private call and the person who started the call open the microphone; everybody else of a topic, a group or a meeting enters muted", () => {
    expect(micOnAtJoin({ kind: "DM", startedByMe: false })).toBe(true);
    expect(micOnAtJoin({ kind: "TOPIC", startedByMe: true })).toBe(true);
    expect(micOnAtJoin({ kind: "TOPIC", startedByMe: false })).toBe(false);
    expect(micOnAtJoin({ kind: "GROUP", startedByMe: false })).toBe(false);
    expect(micOnAtJoin({ kind: "MEETING", startedByMe: false })).toBe(false);
    expect(micOnAtJoin({ kind: "MEETING", startedByMe: true })).toBe(true);
  });

  it("the join bar is for people who are NOT in the call: connecting, in it, or dropped and coming back all count as inside", () => {
    expect(insideCall("c1", { callId: "c1", phase: "in" })).toBe(true);
    expect(insideCall("c1", { callId: "c1", phase: "connecting" })).toBe(true);
    expect(insideCall("c1", { callId: "c1", phase: "lost" })).toBe(true);
    expect(insideCall("c1", { callId: "c1", phase: "left" })).toBe(false);
    expect(insideCall("c1", { callId: "c1", phase: "ended" })).toBe(false);
    expect(insideCall("c1", { callId: "c2", phase: "in" })).toBe(false);
    expect(insideCall("c1", { callId: null, phase: "idle" })).toBe(false);
  });
});
