import { describe, expect, it } from "vitest";
import { canSwitchOversight, capabilityGroups, toggleCapability, type ActorInfo, type CapabilityTarget } from "@/lib/members-ui";
import { CAPABILITIES } from "@/server/policy/capabilities";

/**
 * P0.1: the switch «الأرشيف والرقابة» is on a PARTNER's sheet, for the PRIMARY owner only, and for no other rank.
 */
const primary: ActorInfo = { id: "o", role: "OWNER", caps: CAPABILITIES, primaryOwner: true };
const partnerActor: ActorInfo = { id: "p", role: "OWNER", caps: CAPABILITIES, primaryOwner: false };
const admin: ActorInfo = { id: "a", role: "ADMIN", caps: ["users.manage"] };
const partner: CapabilityTarget = { role: "OWNER", capabilities: [], revokedCapabilities: [], primaryOwner: false };

describe("the oversight switch on a person's sheet", () => {
  it("is offered to the primary owner for a partner, first in the list, on, and unlocked", () => {
    const group = capabilityGroups(partner, primary, true)[0];
    expect(group?.id).toBe("oversight");
    expect(group?.rows).toHaveLength(1);
    expect(group?.rows[0]).toMatchObject({ capability: "archive.view", on: true, locked: null });
  });

  it("is not offered to a partner, to an admin, or on a read-only sheet", () => {
    expect(capabilityGroups(partner, partnerActor, true).some((g) => g.id === "oversight")).toBe(false);
    expect(capabilityGroups(partner, admin, true).some((g) => g.id === "oversight")).toBe(false);
    expect(capabilityGroups(partner, primary, false).some((g) => g.id === "oversight")).toBe(false);
  });

  it("is not offered for any other rank, nor for the primary owner himself", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
      const target: CapabilityTarget = { role, capabilities: [], revokedCapabilities: [] };
      expect(canSwitchOversight(target, primary), role).toBe(false);
    }
    expect(canSwitchOversight({ role: "OWNER", capabilities: [], revokedCapabilities: [], primaryOwner: true }, primary)).toBe(false);
  });

  it("switching it off stores it as revoked, and on again removes it", () => {
    const off = toggleCapability(partner, "archive.view", false);
    expect(off.revokedCapabilities).toContain("archive.view");
    const row = capabilityGroups({ ...partner, ...off }, primary, true)[0]?.rows[0];
    expect(row).toMatchObject({ on: false, customized: true });
    const on = toggleCapability({ ...partner, ...off }, "archive.view", true);
    expect(on.revokedCapabilities).not.toContain("archive.view");
  });
});
