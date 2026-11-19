import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  RANK_DEFAULTS,
  CAPABILITY_FEATURE,
  OWNER_ONLY,
  SECTION_CAPABILITIES,
  WIRED_CAPABILITIES,
  can,
  effectiveCapabilities,
  explainCapabilities,
  grantProblem,
  isCapability,
  type Capability,
  type CapabilitySource,
  type ExplainReason,
} from "../src/server/policy/capabilities";
import { FEATURES, isFeatureKey, withFeature } from "../src/lib/features";
import { CREATABLE_ROLES, atLeast, outranks, rankOf } from "../src/server/policy/rank";
import { DEFAULT_TRANSPARENCY_VERSION, onboardingStateOf, transparencyVersionOf } from "../src/server/policy/org-settings";

describe("rank", () => {
  it("orders OWNER > ADMIN > LEAD > MEMBER > GUEST", () => {
    expect(rankOf("OWNER")).toBeGreaterThan(rankOf("ADMIN"));
    expect(rankOf("ADMIN")).toBeGreaterThan(rankOf("LEAD"));
    expect(rankOf("LEAD")).toBeGreaterThan(rankOf("MEMBER"));
    expect(rankOf("MEMBER")).toBeGreaterThan(rankOf("GUEST"));
    expect(outranks("LEAD", "MEMBER")).toBe(true);
    expect(outranks("MEMBER", "MEMBER")).toBe(false);
    expect(atLeast("MEMBER", "MEMBER")).toBe(true);
    expect(atLeast("GUEST", "MEMBER")).toBe(false);
  });

  it("there is exactly one OWNER: it can never be the role of a newly created account", () => {
    expect(CREATABLE_ROLES).not.toContain("OWNER");
    expect(CREATABLE_ROLES).toEqual(["ADMIN", "LEAD", "MEMBER", "GUEST"]);
  });
});

describe("capabilities", () => {
  it("the OWNER can do everything, including the owner-only archive", () => {
    expect([...effectiveCapabilities({ role: "OWNER" })].sort()).toEqual([...CAPABILITIES].sort());
  });

  it("rank defaults: an ADMIN manages users and integrations, a MEMBER does neither", () => {
    expect(can({ role: "ADMIN" }, "users.manage")).toBe(true);
    expect(can({ role: "ADMIN" }, "integrations.manage")).toBe(true);
    expect(can({ role: "MEMBER" }, "users.manage")).toBe(false);
    expect(can({ role: "MEMBER" }, "integrations.manage")).toBe(false);
    expect(can({ role: "LEAD" }, "directory.view")).toBe(true);
  });

  it("the owner can switch a single capability on for a person (the automation person)", () => {
    expect(can({ role: "MEMBER", capabilities: ["integrations.manage"] }, "integrations.manage")).toBe(true);
  });

  it("...or off (an admin who must not see prices)", () => {
    expect(can({ role: "ADMIN", revokedCapabilities: ["prices.view"] }, "prices.view")).toBe(false);
    expect(can({ role: "ADMIN", revokedCapabilities: ["prices.view"] }, "crm.view")).toBe(true);
  });

  it("an external partner (GUEST) holds NO capability, even if one was stored for them", () => {
    expect(effectiveCapabilities({ role: "GUEST" }).size).toBe(0);
    for (const c of CAPABILITIES) expect(can({ role: "GUEST", capabilities: [c] }, c), c).toBe(false);
    expect(RANK_DEFAULTS.GUEST).toEqual([]);
  });

  it("the archive/oversight capability can never be handed to anyone below the owner", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      expect(can({ role, capabilities: ["archive.view"] }, "archive.view"), role).toBe(false);
    }
  });

  it("unknown capability names stored in the database are ignored, not trusted", () => {
    expect(isCapability("users.manage")).toBe(true);
    expect(isCapability("root")).toBe(false);
    expect(can({ role: "MEMBER", capabilities: ["root", "users.manage" as never] }, "users.manage")).toBe(true);
    expect(effectiveCapabilities({ role: "MEMBER", capabilities: ["root"] }).size).toBe(RANK_DEFAULTS.MEMBER.length);
  });

  it("grantProblem explains why a switch is refused", () => {
    expect(grantProblem("MEMBER", "integrations.manage")).toBeNull();
    expect(grantProblem("GUEST", "crm.view")).toBe("not_for_guests");
    expect(grantProblem("ADMIN", "archive.view")).toBe("owner_only");
    expect(grantProblem("OWNER", "crm.view")).toBe("owner_has_all");
    expect(grantProblem("MEMBER", "root")).toBe("unknown_capability");
  });
});

describe("onboarding state (the transparency notice)", () => {
  it("everybody has to accept the notice once: a user who never accepted is pending", () => {
    expect(onboardingStateOf({ mustChangePassword: false, transparencyVersion: null }, {})).toEqual({
      mustChangePassword: false,
      transparencyPending: true,
    });
  });

  it("accepting the current version clears it; a later version makes everybody accept again", () => {
    const accepted = { mustChangePassword: false, transparencyVersion: DEFAULT_TRANSPARENCY_VERSION };
    expect(onboardingStateOf(accepted, {}).transparencyPending).toBe(false);
    expect(onboardingStateOf(accepted, { transparencyVersion: 2 }).transparencyPending).toBe(true);
  });

  it("a temporary password is reported", () => {
    expect(onboardingStateOf({ mustChangePassword: true, transparencyVersion: 1 }, {}).mustChangePassword).toBe(true);
  });

  it("broken settings JSON falls back to the default version instead of locking everybody out", () => {
    expect(transparencyVersionOf({ transparencyVersion: "two" })).toBe(DEFAULT_TRANSPARENCY_VERSION);
    expect(transparencyVersionOf(null)).toBe(DEFAULT_TRANSPARENCY_VERSION);
    expect(transparencyVersionOf({ transparencyVersion: 3, other: 1 })).toBe(3);
  });
});

describe("wired capabilities (the switches the people screen offers)", () => {
  it("are all real capabilities, never the owner-only archive, and each one is held by some rank by default", () => {
    for (const c of WIRED_CAPABILITIES) {
      expect(CAPABILITIES, c).toContain(c);
      expect(c).not.toBe("archive.view");
      expect(Object.values(RANK_DEFAULTS).some((list) => list.includes(c)), c).toBe(true);
    }
  });
});

describe("what is still wired to nothing (A1.2, R12 of docs/PHASE0-AUDIT.md)", () => {
  it("announce.send and escalation.configure are wired now (Q1.6, Q1.5) and offered again; cash.view and penalties.view are not", () => {
    expect(WIRED_CAPABILITIES).toContain("announce.send");
    expect(WIRED_CAPABILITIES).toContain("escalation.configure");
    const notWired = CAPABILITIES.filter((c) => !WIRED_CAPABILITIES.includes(c)).sort();
    // the owner-only archive is a switch of its own on a partner's sheet; the other two come with I1.3
    expect(notWired).toEqual(["archive.view", "cash.view", "penalties.view"]);
  });
});

// ------------------------------------------------------------------------------------------------
// «شو بيقدر يعمل؟»: explainCapabilities must agree with effectiveCapabilities for every rank x switch
// ------------------------------------------------------------------------------------------------

/** Every company switch ON (economy mode OFF): nothing is held back, so the section grid is the only variable. */
const ALL_ON = FEATURES.reduce<Record<string, unknown>>((settings, key) => withFeature(settings, key, key !== "economyMode"), {});
const GRID_ON = ALL_ON;
const GRID_OFF = withFeature(ALL_ON, "sectionPermissions", false);

/** Every kind of person the policy knows, each with every stored shape worth checking. */
const PEOPLE: { label: string; base: CapabilitySource }[] = [
  { label: "primary owner", base: { role: "OWNER", primaryOwner: true } },
  { label: "partner", base: { role: "OWNER", primaryOwner: false } },
  { label: "admin", base: { role: "ADMIN" } },
  { label: "lead", base: { role: "LEAD" } },
  { label: "member", base: { role: "MEMBER" } },
  { label: "guest", base: { role: "GUEST" } },
];

function storedShapes(base: CapabilitySource): { label: string; member: CapabilitySource }[] {
  const shapes: { label: string; member: CapabilitySource }[] = [
    { label: "nothing stored", member: base },
    { label: "everything added", member: { ...base, capabilities: [...CAPABILITIES] } },
    { label: "everything removed", member: { ...base, revokedCapabilities: [...CAPABILITIES] } },
    { label: "added and removed", member: { ...base, capabilities: [...CAPABILITIES], revokedCapabilities: [...CAPABILITIES] } },
    { label: "an unknown name", member: { ...base, capabilities: ["root"], revokedCapabilities: ["nope"] } },
  ];
  for (const c of CAPABILITIES) {
    shapes.push({ label: `added ${c}`, member: { ...base, capabilities: [c] } });
    shapes.push({ label: `removed ${c}`, member: { ...base, revokedCapabilities: [c] } });
  }
  return shapes;
}

const HELD_REASONS: readonly ExplainReason[] = ["owner", "rank_default", "added", "grid_off"];
const NOT_HELD_REASONS: readonly ExplainReason[] = ["removed", "rank_lacks", "guest", "owner_only", "needs_view", "grid_off"];

describe("explainCapabilities: the view never promises what the server refuses", () => {
  it("lists every capability once, in the catalogue's order", () => {
    expect(explainCapabilities({ role: "MEMBER" }, ALL_ON).map((e) => e.capability)).toEqual([...CAPABILITIES]);
  });

  for (const settings of [GRID_ON, GRID_OFF]) {
    const gridOn = settings === GRID_ON;
    for (const { label, base } of PEOPLE) {
      it(`${label}, section grid ${gridOn ? "on" : "off"}: held is exactly effectiveCapabilities, for every stored shape`, () => {
        for (const { label: shape, member } of storedShapes(base)) {
          const effective = effectiveCapabilities(member, { sectionGrid: gridOn });
          const rows = explainCapabilities(member, settings);
          const held = new Set(rows.filter((r) => r.held).map((r) => r.capability));
          expect([...held].sort(), `${label} / ${shape}`).toEqual([...effective].sort());
          for (const r of rows) {
            // the reason matches the verdict, and what is usable is never more than what is held
            expect(r.held ? HELD_REASONS : NOT_HELD_REASONS, `${label} / ${shape} / ${r.capability}: ${r.basis}`).toContain(r.basis);
            if (r.usable) expect(r.held, `${label} / ${shape} / ${r.capability}`).toBe(true);
            // every company switch is on here, so nothing is held back by one
            expect(r.usable, `${label} / ${shape} / ${r.capability}`).toBe(r.held);
            expect(r.reason).toBe(r.basis);
          }
        }
      });
    }
  }

  it("the grid_off reason appears only while «صلاحيات الأقسام» is off, and only on the grid's own boxes", () => {
    const on = explainCapabilities({ role: "MEMBER", revokedCapabilities: ["tasks.view"] }, GRID_ON);
    expect(on.some((r) => r.basis === "grid_off")).toBe(false);
    const off = explainCapabilities({ role: "MEMBER", revokedCapabilities: ["tasks.view"] }, GRID_OFF);
    const offBoxes = off.filter((r) => r.basis === "grid_off").map((r) => r.capability);
    expect(offBoxes.length).toBeGreaterThan(0);
    for (const c of offBoxes) expect(SECTION_CAPABILITIES).toContain(c);
    // the customers' view and edit were switches of their own before the grid: they keep their own reasons
    expect(off.find((r) => r.capability === "crm.view")?.basis).not.toBe("grid_off");
    expect(off.find((r) => r.capability === "crm.edit")?.basis).not.toBe("grid_off");
    // a stored removal of a grid box is ignored while the grid is off: the rank's template decides
    expect(off.find((r) => r.capability === "tasks.view")).toMatchObject({ held: true, basis: "grid_off" });
  });

  it("says WHY, in the words of the plan: rank default, added by hand, removed by hand, not in the rank", () => {
    const of = (member: CapabilitySource, capability: Capability, settings: unknown = ALL_ON) =>
      explainCapabilities(member, settings).find((r) => r.capability === capability)!;
    expect(of({ role: "MEMBER" }, "tasks.view")).toMatchObject({ held: true, basis: "rank_default" });
    expect(of({ role: "MEMBER" }, "users.manage")).toMatchObject({ held: false, basis: "rank_lacks" });
    expect(of({ role: "MEMBER", capabilities: ["users.manage"] }, "users.manage")).toMatchObject({ held: true, basis: "added" });
    expect(of({ role: "ADMIN", revokedCapabilities: ["prices.view"] }, "prices.view")).toMatchObject({ held: false, basis: "removed" });
    // a person who was both given and refused a switch: the refusal wins, as in effectiveCapabilities
    expect(of({ role: "MEMBER", capabilities: ["users.manage"], revokedCapabilities: ["users.manage"] }, "users.manage")).toMatchObject({ held: false, basis: "removed" });
    // a removal of something the rank never gave changes nothing: it is simply not in the rank
    expect(of({ role: "MEMBER", revokedCapabilities: ["users.manage"] }, "users.manage")).toMatchObject({ held: false, basis: "rank_lacks" });
    // the lead's rank gives the prices
    expect(of({ role: "LEAD" }, "prices.view")).toMatchObject({ held: true, basis: "rank_default" });
    expect(of({ role: "MEMBER" }, "prices.view")).toMatchObject({ held: false, basis: "rank_lacks" });
  });

  it("an external partner holds nothing, whatever was stored; the archive is the owner rank's alone", () => {
    for (const r of explainCapabilities({ role: "GUEST", capabilities: [...CAPABILITIES] }, ALL_ON)) {
      expect(r).toMatchObject({ held: false, usable: false, basis: "guest" });
    }
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const row = explainCapabilities({ role, capabilities: ["archive.view"] }, ALL_ON).find((r) => r.capability === "archive.view")!;
      expect(row, role).toMatchObject({ held: false, basis: "owner_only" });
    }
    expect(OWNER_ONLY).toContain("archive.view");
  });

  it("the primary owner holds everything; a partner holds all but what the primary owner took away", () => {
    for (const r of explainCapabilities({ role: "OWNER", primaryOwner: true, revokedCapabilities: ["prices.view"] }, ALL_ON)) {
      expect(r).toMatchObject({ held: true, basis: "owner" });
    }
    const partner = explainCapabilities({ role: "OWNER", primaryOwner: false, revokedCapabilities: ["archive.view", "prices.view"] }, ALL_ON);
    expect(partner.find((r) => r.capability === "archive.view")).toMatchObject({ held: false, basis: "removed" });
    expect(partner.find((r) => r.capability === "prices.view")).toMatchObject({ held: false, basis: "removed" });
    expect(partner.find((r) => r.capability === "tasks.view")).toMatchObject({ held: true, basis: "owner" });
  });

  it("add/edit and delete of a section need its «يشوف»: without it they are off, and the reason says so", () => {
    const rows = explainCapabilities({ role: "MEMBER", revokedCapabilities: ["tasks.view"] }, ALL_ON);
    const of = (c: Capability) => rows.find((r) => r.capability === c)!;
    expect(of("tasks.view")).toMatchObject({ held: false, basis: "removed" });
    expect(of("tasks.edit")).toMatchObject({ held: false, basis: "needs_view" });
    expect(of("tasks.delete")).toMatchObject({ held: false, basis: "needs_view" });
    // a box the person never had is not blamed on the missing «يشوف»
    const lead = explainCapabilities({ role: "MEMBER", revokedCapabilities: ["goals.view"] }, ALL_ON);
    expect(lead.find((r) => r.capability === "goals.edit")).toMatchObject({ held: false, basis: "rank_lacks" });
  });

  it("a feature the company switched off: still held (the server's own check), no longer usable, and the reason names the switch", () => {
    const off = withFeature(ALL_ON, "calls", false);
    const rows = explainCapabilities({ role: "ADMIN" }, off);
    expect(rows.find((r) => r.capability === "calls.view")).toMatchObject({ held: true, usable: false, basis: "rank_default", reason: "feature_off", feature: "calls" });
    expect(rows.find((r) => r.capability === "calls.edit")).toMatchObject({ held: true, usable: false, reason: "feature_off" });
    // somebody without the box is not told it is the switch's fault
    const without = explainCapabilities({ role: "MEMBER", revokedCapabilities: ["calls.view"] }, off).find((r) => r.capability === "calls.view")!;
    expect(without).toMatchObject({ held: false, usable: false, reason: "removed" });
    // unrelated switches do not matter; the default is ON
    expect(explainCapabilities({ role: "ADMIN" }, withFeature(ALL_ON, "okr", false)).every((r) => r.usable === r.held)).toBe(true);
    // «وضع التوفير» holds the heavy features off, and the explanation follows
    const economy = withFeature(ALL_ON, "economyMode", true);
    expect(explainCapabilities({ role: "ADMIN" }, economy).find((r) => r.capability === "calls.view")).toMatchObject({ usable: false, reason: "feature_off" });
  });

  it("the company's defaults: announcements and escalation sit behind switches that start OFF, and the view says so", () => {
    const rows = explainCapabilities({ role: "ADMIN" }, {});
    expect(rows.find((r) => r.capability === "announce.send")).toMatchObject({ held: true, usable: false, reason: "feature_off", feature: "mustRead" });
    expect(rows.find((r) => r.capability === "escalation.configure")).toMatchObject({ held: true, usable: false, reason: "feature_off", feature: "autoTickets" });
    // the same person once the owner switches them on
    const on = explainCapabilities({ role: "ADMIN" }, withFeature(withFeature({}, "mustRead", true), "autoTickets", true));
    expect(on.find((r) => r.capability === "announce.send")).toMatchObject({ usable: true, reason: "rank_default" });
    expect(on.find((r) => r.capability === "escalation.configure")).toMatchObject({ usable: true, reason: "rank_default" });
  });

  it("every capability behind a company switch names a real switch", () => {
    for (const [capability, feature] of Object.entries(CAPABILITY_FEATURE)) {
      expect(isCapability(capability), capability).toBe(true);
      expect(isFeatureKey(feature), `${capability} -> ${String(feature)}`).toBe(true);
    }
    expect(CAPABILITY_FEATURE["escalation.configure"]).toBe("autoTickets");
    expect(CAPABILITY_FEATURE["announce.send"]).toBe("mustRead");
  });
});
