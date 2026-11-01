import { describe, expect, it } from "vitest";
import { CAPABILITIES, OWNER_ONLY, RANK_DEFAULTS, SECTION_CAPABILITIES, WIRED_CAPABILITIES, can, effectiveCapabilities } from "@/server/policy/capabilities";

/** The wired capabilities shown as switches: the section boxes are the grid's (tests/section-grid.test.ts). */
const SWITCHES = WIRED_CAPABILITIES.filter((c) => !SECTION_CAPABILITIES.includes(c));
import { CREATABLE_ROLES } from "@/server/policy/rank";
import { getServerT } from "@/lib/i18n/server";
import { ApiError } from "@/lib/api-client";
import {
  CAPABILITY_GROUPS,
  EMPTY_ADD_FORM,
  SENSITIVE_CAPABILITIES,
  arabicPlural,
  buildCreatePayload,
  buildInfoPatch,
  buildLoginMessage,
  canAdministrate,
  canAssignRole,
  canResetCapabilities,
  capabilityGroups,
  sectionGrid,
  capabilityListsAfterRankChange,
  creatableRoles,
  filterMembers,
  managerCandidates,
  memberErrorMessage,
  normalizeSearch,
  normalizeUsername,
  offeredActions,
  passwordProblem,
  relativeTimeAr,
  resetCapabilityLists,
  sortMembers,
  spacesSummary,
  statusCounts,
  toggleCapability,
  transferCandidates,
  validateAddForm,
  validateInfoForm,
  type ActorInfo,
  type ContractMember,
  type OrgRoleName,
} from "@/lib/members-ui";

const { t } = getServerT();

const ROLES: OrgRoleName[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

function person(over: Partial<ContractMember> = {}): ContractMember {
  const role = over.role ?? "MEMBER";
  const capabilities = over.capabilities ?? [];
  const revokedCapabilities = over.revokedCapabilities ?? [];
  return {
    id: "u-1",
    name: "منار",
    username: "manar",
    email: null,
    jobTitle: null,
    role,
    status: "ACTIVE",
    managerId: null,
    managerName: null,
    capabilities,
    revokedCapabilities,
    effectiveCapabilities: [...effectiveCapabilities({ role, capabilities, revokedCapabilities })],
    lastLoginAt: null,
    mustChangePassword: false,
    openWork: 0,
    workspaces: [],
    ...over,
  };
}

function actorOf(role: OrgRoleName, over: Partial<ActorInfo> = {}): ActorInfo {
  return { id: "actor", role, caps: [...effectiveCapabilities({ role })], ...over };
}

describe("who may administer whom (the UI never offers what the server refuses)", () => {
  // actor role -> the target roles that actor may administer (the server's rule, member-rules.ts)
  const MAY: Record<OrgRoleName, OrgRoleName[]> = {
    OWNER: ["ADMIN", "LEAD", "MEMBER", "GUEST"],
    ADMIN: ["LEAD", "MEMBER", "GUEST"], // only the OWNER administers ADMINs
    LEAD: ["MEMBER", "GUEST"], // everybody else strictly below their own rank (a peer is not below)
    MEMBER: ["GUEST"],
    GUEST: [],
  };

  it("nobody acts on the OWNER; only the OWNER acts on ADMINs; everybody else strictly below their own rank", () => {
    for (const actor of ROLES) {
      for (const target of ROLES) {
        expect(canAdministrate(actor, target), `${actor} -> ${target}`).toBe(MAY[actor].includes(target));
      }
    }
  });

  it("an account can be created with a rank strictly below the creator's: only the OWNER creates ADMINs", () => {
    expect(creatableRoles("OWNER")).toEqual(["ADMIN", "LEAD", "MEMBER", "GUEST"]);
    expect(creatableRoles("ADMIN")).toEqual(["LEAD", "MEMBER", "GUEST"]);
    expect(creatableRoles("LEAD")).toEqual(["MEMBER", "GUEST"]);
    expect(creatableRoles("MEMBER")).toEqual(["GUEST"]);
    expect(creatableRoles("GUEST")).toEqual([]);
    for (const role of ROLES) {
      expect(creatableRoles(role)).not.toContain("OWNER");
      for (const r of creatableRoles(role)) expect(CREATABLE_ROLES).toContain(r);
    }
  });

  it("a rank can be changed only on somebody the actor administers, to a rank the actor may create", () => {
    expect(canAssignRole("OWNER", "MEMBER", "ADMIN")).toBe(true);
    expect(canAssignRole("ADMIN", "MEMBER", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "MEMBER", "LEAD")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN", "MEMBER")).toBe(false);
    expect(canAssignRole("OWNER", "OWNER", "MEMBER")).toBe(false);
    expect(canAssignRole("OWNER", "MEMBER", "OWNER")).toBe(false);
  });
});

describe("which actions the sheet offers", () => {
  const none = {
    manageable: false,
    edit: false,
    rankChoices: [],
    suspend: false,
    offboard: false,
    reactivate: false,
    resetPassword: false,
    logoutEverywhere: false,
  };

  it("the OWNER on an active ADMIN: everything except reactivate", () => {
    const a = offeredActions(actorOf("OWNER"), person({ role: "ADMIN" }));
    expect(a).toMatchObject({
      isSelf: false,
      manageable: true,
      edit: true,
      rankChoices: ["ADMIN", "LEAD", "MEMBER", "GUEST"],
      capabilities: "editable",
      suspend: true,
      offboard: true,
      reactivate: false,
      resetPassword: true,
      logoutEverywhere: true,
    });
  });

  it("a SUSPENDED person can be reactivated, edited or offboarded, but not signed out again or password-reset", () => {
    const a = offeredActions(actorOf("OWNER"), person({ status: "SUSPENDED" }));
    expect(a).toMatchObject({
      edit: true,
      capabilities: "editable",
      reactivate: true,
      offboard: true,
      suspend: false,
      resetPassword: false,
      logoutEverywhere: false,
    });
  });

  it("an OFFBOARDED person can only be reactivated", () => {
    const a = offeredActions(actorOf("OWNER"), person({ status: "OFFBOARDED" }));
    expect(a).toMatchObject({ ...none, manageable: true, reactivate: true, capabilities: "readonly" });
  });

  it("nobody acts on themselves, whatever their rank", () => {
    for (const role of ROLES) {
      const me = actorOf(role, { id: "me" });
      const a = offeredActions(me, person({ id: "me", role }));
      expect(a, role).toMatchObject({ ...none, isSelf: true });
      expect(a.capabilities, role).not.toBe("editable");
    }
  });

  it("nobody acts on the OWNER: the capability panel says so instead", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) {
      const a = offeredActions(actorOf(role), person({ id: "boss", role: "OWNER" }));
      expect(a, role).toMatchObject({ ...none, capabilities: "owner" });
    }
  });

  it("an ADMIN administers LEAD, MEMBER and GUEST but not another ADMIN", () => {
    const admin = actorOf("ADMIN");
    for (const role of ["LEAD", "MEMBER", "GUEST"] as const) {
      expect(offeredActions(admin, person({ role })).manageable, role).toBe(true);
    }
    const peer = offeredActions(admin, person({ role: "ADMIN" }));
    expect(peer).toMatchObject({ ...none, capabilities: "readonly" });
  });

  it("an ADMIN can only hand out ranks below ADMIN", () => {
    expect(offeredActions(actorOf("ADMIN"), person({ role: "MEMBER" })).rankChoices).toEqual(["LEAD", "MEMBER", "GUEST"]);
  });

  it("a guest shows the external-partner sentence, never switches", () => {
    expect(offeredActions(actorOf("ADMIN"), person({ role: "GUEST" })).capabilities).toBe("guest");
    expect(offeredActions(actorOf("OWNER"), person({ role: "GUEST", status: "SUSPENDED" })).capabilities).toBe("guest");
  });

  it("a MEMBER who was given users.manage may administer guests only: a peer MEMBER is not below them", () => {
    const helper = actorOf("MEMBER");
    expect(offeredActions(helper, person({ role: "GUEST" })).manageable).toBe(true);
    expect(offeredActions(helper, person({ role: "MEMBER" })).manageable).toBe(false);
    expect(offeredActions(helper, person({ role: "LEAD" })).manageable).toBe(false);
    expect(offeredActions(helper, person({ role: "ADMIN" })).manageable).toBe(false);
    expect(offeredActions(helper, person({ role: "GUEST" })).rankChoices).toEqual(["GUEST"]);
  });

  it("the status actions follow the server's transitions: suspend from ACTIVE, reactivate from SUSPENDED or OFFBOARDED, offboard from ACTIVE or SUSPENDED", () => {
    const owner = actorOf("OWNER");
    const flags = (status: ContractMember["status"]) => {
      const a = offeredActions(owner, person({ status }));
      return { suspend: a.suspend, reactivate: a.reactivate, offboard: a.offboard };
    };
    expect(flags("ACTIVE")).toEqual({ suspend: true, reactivate: false, offboard: true });
    expect(flags("SUSPENDED")).toEqual({ suspend: false, reactivate: true, offboard: true });
    expect(flags("OFFBOARDED")).toEqual({ suspend: false, reactivate: true, offboard: false });
  });
});

describe("capability switches: rank defaults + extras - revoked", () => {
  // the switches and the section grid's boxes: one row per wired capability, same state and locks
  const rows = (member: ContractMember, actor: ActorInfo = actorOf("OWNER"), editable = true) =>
    new Map(
      [
        ...capabilityGroups(member, actor, editable).flatMap((g) => g.rows),
        ...sectionGrid(member, actor, editable).flatMap((r) => Object.values(r.cells).filter((c) => c !== null)),
      ].map((r) => [r.capability, r]),
    );
  const offered = (member: ContractMember, actor: ActorInfo = actorOf("OWNER")) =>
    capabilityGroups(member, actor, true).flatMap((g) => g.rows.map((r) => r.capability));
  const hidden = CAPABILITIES.filter((c) => !WIRED_CAPABILITIES.includes(c));

  it("the groups cover every capability exactly once, except the owner-only archive and the section grid's boxes", () => {
    const grouped = CAPABILITY_GROUPS.flatMap((g) => [...g.capabilities]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped, ...SECTION_CAPABILITIES, ...OWNER_ONLY].sort()).toEqual([...CAPABILITIES].sort());
    expect(grouped).not.toContain("archive.view");
  });

  it("every switch and every group has an Arabic title, and every switch a one-line explanation", () => {
    for (const group of CAPABILITY_GROUPS) {
      expect(t(`members.group_${group.id}`), group.id).not.toBe(`members.group_${group.id}`);
      for (const cap of group.capabilities) {
        expect(t(`members.cap.${cap}.title`), cap).not.toBe(`members.cap.${cap}.title`);
        const hint = t(`members.cap.${cap}.hint`);
        expect(hint, cap).not.toBe(`members.cap.${cap}.hint`);
        expect(hint).not.toContain("\n");
      }
    }
  });

  it("only the WIRED capabilities are offered: a switch that does nothing is a lie on the screen", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const shown = offered(person({ role }));
      expect([...shown].sort(), role).toEqual([...SWITCHES].sort());
      for (const cap of hidden) expect(shown, `${role} ${cap}`).not.toContain(cap);
    }
    expect(hidden.length).toBeGreaterThan(0); // the catalogue is larger than what is wired today
  });

  it("the catalogue's other capabilities (and archive.view, always) are never rows, whoever looks", () => {
    for (const actor of [actorOf("OWNER"), actorOf("ADMIN")]) {
      const shown = offered(person({ role: "ADMIN" }), actor);
      expect(shown).not.toContain("archive.view");
      expect(shown.length).toBe(SWITCHES.length);
    }
  });

  it("a group left with no wired switch is not shown at all; the others keep only their wired switches", () => {
    const groups = capabilityGroups(person({ role: "MEMBER" }), actorOf("OWNER"), true);
    const expected = CAPABILITY_GROUPS.filter((g) => g.capabilities.some((c) => WIRED_CAPABILITIES.includes(c))).map((g) => g.id);
    expect(groups.map((g) => g.id)).toEqual(expected);
    expect(groups.length).toBeLessThan(CAPABILITY_GROUPS.length);
    for (const g of groups) {
      expect(g.rows.length).toBeGreaterThan(0);
      for (const row of g.rows) expect(WIRED_CAPABILITIES).toContain(row.capability);
    }
  });

  it("the state is the policy's own: it equals can() for every capability and every rank", () => {
    for (const role of ROLES) {
      const member = person({ role, capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"] });
      for (const row of rows(member).values()) {
        expect(row.on, `${role} ${row.capability}`).toBe(can(member, row.capability));
      }
    }
  });

  it("shows the rank default next to the real state, and what the owner changed", () => {
    const member = person({ role: "MEMBER", capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"] });
    const r = rows(member);
    expect(r.get("crm.view")).toMatchObject({ on: true, rankDefault: true, customized: false });
    expect(r.get("crm.edit")).toMatchObject({ on: false, rankDefault: true, customized: true });
    expect(r.get("integrations.manage")).toMatchObject({ on: true, rankDefault: false, customized: true });
    expect(r.get("users.manage")).toMatchObject({ on: false, rankDefault: false, customized: false });
  });

  it("the OWNER may switch every wired switch of a non-guest; an ADMIN, who holds them all but «لوحة الفريق», «الهيكل», «تقييم الفريق» and «الكلفة والأسعار» (the owner's alone to hand out), too", () => {
    const member = person({ role: "MEMBER" });
    for (const row of rows(member, actorOf("OWNER")).values()) expect(row.locked, row.capability).toBeNull();
    for (const row of rows(member, actorOf("ADMIN")).values()) {
      expect(row.locked, row.capability).toBe(["board.team", "people.manage_lines", "people.review", "manufacturing.cost"].includes(row.capability) ? "actor_lacks" : null);
    }
  });

  it("a person can hand out only what they hold: the other switches show locked", () => {
    const member = person({ role: "MEMBER" });
    // a team lead who was given users.manage holds it and the lead defaults, but not integrations.manage
    const lead = actorOf("LEAD", { caps: [...RANK_DEFAULTS.LEAD, "users.manage"] });
    const byLead = rows(member, lead);
    expect(byLead.get("integrations.manage")?.locked).toBe("actor_lacks");
    // and no longer spaces.create: a lead does not hold it by default (the owner's decision, 2026-10-25)
    expect(byLead.get("spaces.create")?.locked).toBe("actor_lacks");
    for (const cap of ["users.manage", "directory.view", "crm.view", "crm.edit"] as const) {
      expect(byLead.get(cap)?.locked, cap).toBeNull();
    }
    // an admin whom the owner took integrations.manage away from cannot hand it out either
    const admin = actorOf("ADMIN", { caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "integrations.manage") });
    expect(rows(member, admin).get("integrations.manage")?.locked).toBe("actor_lacks");
  });

  it("nothing is switchable when the sheet is read-only, or for a guest", () => {
    for (const row of rows(person(), actorOf("OWNER"), false).values()) expect(row.locked).toBe("readonly");
    for (const row of rows(person({ role: "GUEST" }), actorOf("OWNER")).values()) {
      expect(row.on).toBe(false);
      expect(row.locked).toBe("not_grantable");
    }
  });

  it("flags the sensitive switches (accounts, integrations, the company's money), and only switches that are offered", () => {
    const r = rows(person({ role: "MEMBER" }));
    for (const cap of ["users.manage", "integrations.manage"] as const) expect(r.get(cap)?.sensitive, cap).toBe(true);
    expect(r.get("crm.view")?.sensitive).toBe(false);
    for (const cap of SENSITIVE_CAPABILITIES) expect(WIRED_CAPABILITIES, cap).toContain(cap);
  });

  it("the amount's switch is offered and marked ⚠️: a member does not hold it by rank, and it shows the company's money", () => {
    const member = person({ role: "MEMBER" });
    expect(offered(member)).toContain("prices.view");
    expect(rows(member).get("prices.view")).toMatchObject({ on: false, rankDefault: false, sensitive: true, locked: null });
    // the ranks the catalogue gives it to start switched on
    expect(rows(person({ role: "LEAD" })).get("prices.view")).toMatchObject({ on: true, rankDefault: true });
    // and a guest can never be handed it
    expect(rows(person({ role: "GUEST" })).get("prices.view")).toMatchObject({ on: false, locked: "not_grantable" });
  });

  it("the users.manage switch says what it really allows, and to whom to give it", () => {
    const hint = t("members.cap.users.manage.hint");
    expect(hint).toContain("أدنى"); // people of a LOWER rank, never a peer
    expect(hint).toContain("كلمات مرورهم"); // resets their passwords...
    expect(hint).toContain("الدخول بحساباتهم"); // ...which is signing in as them
    expect(hint).toContain("تثق به"); // give it only to somebody you trust
    expect(hint).not.toContain("\n");
  });
});

describe("capabilities the screen does not show are never lost", () => {
  it("a stored capability that is not displayed still travels in the lists a switch flip sends", () => {
    // a LEAD: cash.view is an owner's extra the screen does not show, and announce.send is stored as revoked (hidden too)
    const lead = person({ role: "LEAD", capabilities: ["cash.view"], revokedCapabilities: ["announce.send"] });
    expect(toggleCapability(lead, "crm.edit", false)).toEqual({
      capabilities: ["cash.view"],
      revokedCapabilities: ["crm.edit", "announce.send"],
    });
    expect(toggleCapability(lead, "integrations.manage", true)).toEqual({
      capabilities: ["integrations.manage", "cash.view"],
      revokedCapabilities: ["announce.send"],
    });
  });

  it("resetting to the rank's defaults clears only displayed switches the person may clear: hidden entries stay", () => {
    const owner = actorOf("OWNER");
    const member = person({
      role: "MEMBER",
      capabilities: ["integrations.manage", "cash.view"],
      revokedCapabilities: ["crm.edit"],
    });
    expect(resetCapabilityLists(member, owner)).toEqual({ capabilities: ["cash.view"], revokedCapabilities: [] });
    expect(canResetCapabilities(member, owner)).toBe(true);
  });

  it("a person cannot take away what they do not hold, so the reset leaves those entries (the server would refuse the whole request)", () => {
    // a team lead with users.manage resets a member whom the owner gave integrations.manage and users.manage
    const lead = actorOf("LEAD", { caps: [...RANK_DEFAULTS.LEAD, "users.manage"] });
    const member = person({ role: "MEMBER", capabilities: ["users.manage", "integrations.manage"] });
    expect(resetCapabilityLists(member, lead)).toEqual({ capabilities: ["integrations.manage"], revokedCapabilities: [] });
    expect(canResetCapabilities(member, lead)).toBe(true);
    // when everything stored is out of reach there is nothing to reset
    const onlyTheirs = person({ role: "MEMBER", capabilities: ["integrations.manage", "cash.view"] });
    expect(canResetCapabilities(onlyTheirs, lead)).toBe(false);
  });

  it("there is nothing to reset when nothing displayed is stored (hidden entries alone do not show the button)", () => {
    const owner = actorOf("OWNER");
    expect(canResetCapabilities(person(), owner)).toBe(false);
    expect(canResetCapabilities(person({ capabilities: ["cash.view"], revokedCapabilities: [] }), owner)).toBe(false);
    // announce.send is an ADMIN default (hidden today) switched off: not the screen's to clear
    expect(canResetCapabilities(person({ role: "ADMIN", revokedCapabilities: ["announce.send"] }), owner)).toBe(false);
    expect(canResetCapabilities(person({ revokedCapabilities: ["crm.edit"] }), owner)).toBe(true);
  });

  it("names the server would refuse are left out of what a reset sends", () => {
    const owner = actorOf("OWNER");
    const member = person({ role: "MEMBER", capabilities: ["legacy.thing", "cash.view"], revokedCapabilities: ["old.thing"] });
    expect(resetCapabilityLists(member, owner)).toEqual({ capabilities: ["cash.view"], revokedCapabilities: [] });
  });
});

describe("what a rank change does to the switches (the server's own composition)", () => {
  const lists = (member: ContractMember) => ({ capabilities: member.capabilities, revokedCapabilities: member.revokedCapabilities });

  it("by the OWNER, who holds everything: the stored lists stay (what the new rank can hold)", () => {
    const member = person({ role: "MEMBER", capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"] });
    expect(capabilityListsAfterRankChange(actorOf("OWNER"), member, "LEAD")).toEqual({
      capabilities: ["integrations.manage"],
      revokedCapabilities: ["crm.edit"],
    });
    expect(capabilityListsAfterRankChange(actorOf("OWNER"), member, "ADMIN")).toEqual(lists(member));
  });

  it("by somebody who lacks some of the new rank's defaults: those start switched off", () => {
    // an admin whom the owner took crm.edit away from promotes a guest to member (MEMBER holds crm.edit by default)
    const admin = actorOf("ADMIN", { caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "crm.edit") });
    const guest = person({ role: "GUEST" });
    expect(capabilityListsAfterRankChange(admin, guest, "MEMBER")).toEqual({ capabilities: [], revokedCapabilities: ["crm.edit"] });
    // defaults count too: the admin without prices.view promotes a member to lead
    const noPrices = actorOf("ADMIN", { caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "prices.view") });
    expect(capabilityListsAfterRankChange(noPrices, person({ role: "MEMBER" }), "LEAD")).toEqual({
      capabilities: [],
      revokedCapabilities: ["prices.view"],
    });
  });

  it("an explicit extra the person already has is not switched off, and the old revoked entries stay", () => {
    const noPrices = actorOf("ADMIN", { caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "prices.view") });
    const member = person({ role: "MEMBER", capabilities: ["prices.view"], revokedCapabilities: ["crm.edit"] });
    expect(capabilityListsAfterRankChange(noPrices, member, "LEAD")).toEqual({
      capabilities: ["prices.view"],
      revokedCapabilities: ["crm.edit"],
    });
  });

  it("becoming a guest clears everything; a guest promoted starts from the rank's defaults", () => {
    const member = person({ role: "MEMBER", capabilities: ["integrations.manage"], revokedCapabilities: ["crm.edit"] });
    expect(capabilityListsAfterRankChange(actorOf("OWNER"), member, "GUEST")).toEqual({ capabilities: [], revokedCapabilities: [] });
  });

  it("the entries come out in the catalogue's order, once each", () => {
    const admin = actorOf("ADMIN", { caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "crm.edit" && c !== "prices.view") });
    const out = capabilityListsAfterRankChange(admin, person({ role: "MEMBER", revokedCapabilities: ["prices.view", "crm.edit"] }), "LEAD");
    expect(out.revokedCapabilities).toEqual(["crm.edit", "prices.view"]);
  });
});

describe("toggling one switch", () => {
  it("switching ON something the rank lacks adds it as an extra", () => {
    expect(toggleCapability(person({ role: "MEMBER" }), "prices.view", true)).toEqual({
      capabilities: ["prices.view"],
      revokedCapabilities: [],
    });
  });

  it("switching OFF something the rank gives revokes it", () => {
    expect(toggleCapability(person({ role: "LEAD" }), "prices.view", false)).toEqual({
      capabilities: [],
      revokedCapabilities: ["prices.view"],
    });
  });

  it("switching back to the rank default leaves no trace", () => {
    const off = person({ role: "LEAD", revokedCapabilities: ["prices.view"] });
    expect(toggleCapability(off, "prices.view", true)).toEqual({ capabilities: [], revokedCapabilities: [] });
    const on = person({ role: "MEMBER", capabilities: ["prices.view"] });
    expect(toggleCapability(on, "prices.view", false)).toEqual({ capabilities: [], revokedCapabilities: [] });
  });

  it("keeps every other real entry once, in the catalogue's order, and leaves out a name the server would refuse", () => {
    const member = person({
      role: "MEMBER",
      capabilities: ["cash.view", "prices.view", "prices.view"],
      revokedCapabilities: ["crm.edit", "legacy.thing"],
    });
    // the server rejects a list with an unknown name (422), so it must not travel back
    expect(toggleCapability(member, "integrations.manage", true)).toEqual({
      capabilities: ["prices.view", "integrations.manage", "cash.view"],
      revokedCapabilities: ["crm.edit"],
    });
    expect(toggleCapability(member, "crm.edit", true)).toEqual({
      capabilities: ["prices.view", "cash.view"],
      revokedCapabilities: [],
    });
  });

  it("the result, applied by the policy, gives exactly the state the owner asked for", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      for (const cap of CAPABILITIES.filter((c) => !OWNER_ONLY.includes(c))) {
        for (const on of [true, false]) {
          const next = toggleCapability(person({ role }), cap, on);
          expect(can({ role, ...next }, cap), `${role} ${cap} ${on}`).toBe(on);
        }
      }
    }
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) expect(RANK_DEFAULTS[role].length).toBeGreaterThan(0);
  });
});

describe("relative time in Arabic", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const H = 3600;
  const D = 86400;

  it("says so when somebody has never signed in", () => {
    expect(relativeTimeAr(null, now, t)).toBe("لم يسجّل دخولًا بعد");
    expect(relativeTimeAr(undefined, now, t)).toBe("لم يسجّل دخولًا بعد");
    expect(relativeTimeAr("not a date", now, t)).toBe("لم يسجّل دخولًا بعد");
  });

  it("just now, and a clock that runs ahead", () => {
    expect(relativeTimeAr(ago(10), now, t)).toBe("الآن");
    expect(relativeTimeAr(ago(-120), now, t)).toBe("الآن");
  });

  it("minutes use the right Arabic number form (one, two, 3-10, 11+)", () => {
    expect(relativeTimeAr(ago(60), now, t)).toBe("قبل دقيقة");
    expect(relativeTimeAr(ago(120), now, t)).toBe("قبل دقيقتين");
    expect(relativeTimeAr(ago(5 * 60), now, t)).toBe("قبل 5 دقائق");
    expect(relativeTimeAr(ago(15 * 60), now, t)).toBe("قبل 15 دقيقة");
  });

  it("hours", () => {
    expect(relativeTimeAr(ago(H), now, t)).toBe("قبل ساعة");
    expect(relativeTimeAr(ago(2 * H), now, t)).toBe("قبل ساعتين");
    expect(relativeTimeAr(ago(3 * H), now, t)).toBe("قبل 3 ساعات");
    expect(relativeTimeAr(ago(11 * H), now, t)).toBe("قبل 11 ساعة");
  });

  it("days", () => {
    expect(relativeTimeAr(ago(D), now, t)).toBe("قبل يوم");
    expect(relativeTimeAr(ago(2 * D), now, t)).toBe("قبل يومين");
    expect(relativeTimeAr(ago(5 * D), now, t)).toBe("قبل 5 أيام");
    expect(relativeTimeAr(ago(12 * D), now, t)).toBe("قبل 12 يومًا");
  });

  it("months and years", () => {
    expect(relativeTimeAr(ago(30 * D), now, t)).toBe("قبل شهر");
    expect(relativeTimeAr(ago(65 * D), now, t)).toBe("قبل شهرين");
    expect(relativeTimeAr(ago(130 * D), now, t)).toBe("قبل 4 أشهر");
    expect(relativeTimeAr(ago(400 * D), now, t)).toBe("قبل سنة");
    expect(relativeTimeAr(ago(800 * D), now, t)).toBe("قبل سنتين");
    expect(relativeTimeAr(ago(4 * 365 * D), now, t)).toBe("قبل 4 سنوات");
  });

  it("the plural categories follow Arabic (1, 2, 3-10, 11-99)", () => {
    expect(arabicPlural(1)).toBe("one");
    expect(arabicPlural(2)).toBe("two");
    for (const n of [3, 4, 10, 103, 110]) expect(arabicPlural(n), String(n)).toBe("few");
    for (const n of [11, 12, 59, 99]) expect(arabicPlural(n), String(n)).toBe("many");
  });
});

describe("search and the status filter", () => {
  const people = [
    person({ id: "1", name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", jobTitle: "المدير العام", status: "ACTIVE" }),
    person({ id: "2", name: "فاطمة", username: "fatima.k", jobTitle: "محاسبة", status: "SUSPENDED" }),
    person({ id: "3", name: "Hassan", username: "hassan", jobTitle: "Programmer", status: "ACTIVE" }),
    person({ id: "4", name: "قبس", username: "qabas", status: "OFFBOARDED" }),
  ];
  const ids = (list: ContractMember[]) => list.map((m) => m.id);

  it("an empty search and ALL keeps everybody", () => {
    expect(ids(filterMembers(people, "", "ALL"))).toEqual(["1", "2", "3", "4"]);
    expect(ids(filterMembers(people, "   ", "ALL"))).toEqual(["1", "2", "3", "4"]);
  });

  it("filters by status", () => {
    expect(ids(filterMembers(people, "", "ACTIVE"))).toEqual(["1", "3"]);
    expect(ids(filterMembers(people, "", "SUSPENDED"))).toEqual(["2"]);
    expect(ids(filterMembers(people, "", "OFFBOARDED"))).toEqual(["4"]);
  });

  it("searches name, username, e-mail and job title, ignoring case", () => {
    expect(ids(filterMembers(people, "HASSAN", "ALL"))).toEqual(["3"]);
    expect(ids(filterMembers(people, "fatima", "ALL"))).toEqual(["2"]);
    expect(ids(filterMembers(people, "example.test", "ALL"))).toEqual(["1"]);
    expect(ids(filterMembers(people, "programmer", "ALL"))).toEqual(["3"]);
    expect(ids(filterMembers(people, "المدير", "ALL"))).toEqual(["1"]);
  });

  it("an Arabic search ignores the spelling variants people type (hamza, ta marbuta, diacritics)", () => {
    expect(ids(filterMembers(people, "احمد", "ALL"))).toEqual(["1"]);
    expect(ids(filterMembers(people, "فاطمه", "ALL"))).toEqual(["2"]);
    expect(ids(filterMembers(people, "مُحاسِبة", "ALL"))).toEqual(["2"]);
    expect(normalizeSearch("  إِبراهيم ")).toBe(normalizeSearch("ابراهيم"));
  });

  it("combines search and status", () => {
    expect(ids(filterMembers(people, "ahmad", "SUSPENDED"))).toEqual([]);
    expect(ids(filterMembers(people, "fatima", "SUSPENDED"))).toEqual(["2"]);
  });

  it("counts every status for the filter pills", () => {
    expect(statusCounts(people)).toEqual({ ALL: 4, ACTIVE: 2, SUSPENDED: 1, OFFBOARDED: 1 });
    expect(statusCounts([])).toEqual({ ALL: 0, ACTIVE: 0, SUSPENDED: 0, OFFBOARDED: 0 });
  });

  it("sorts ACTIVE first, then SUSPENDED, then OFFBOARDED, keeping the server's order inside a status", () => {
    const mixed = [people[3]!, people[1]!, people[0]!, people[2]!];
    expect(ids(sortMembers(mixed))).toEqual(["1", "3", "2", "4"]);
    expect(ids(mixed)).toEqual(["4", "2", "1", "3"]); // the input is not touched
  });
});

describe("pickers", () => {
  const boss = person({ id: "boss", role: "ADMIN" });
  const lead = person({ id: "lead", role: "LEAD", managerId: "boss" });
  const worker = person({ id: "worker", role: "MEMBER", managerId: "lead" });
  const other = person({ id: "other", role: "MEMBER" });
  const partner = person({ id: "partner", role: "GUEST" });
  const suspended = person({ id: "sus", role: "MEMBER", status: "SUSPENDED" });
  const gone = person({ id: "gone", role: "MEMBER", status: "OFFBOARDED" });
  const all = [boss, lead, worker, other, partner, suspended, gone];

  it("a manager is an ACTIVE non-guest person other than the one being edited", () => {
    const ids = managerCandidates(all, "other").map((m) => m.id);
    expect(ids).toEqual(["boss", "lead", "worker"]);
  });

  it("never offers somebody who reports to the person (directly or not): no loops", () => {
    expect(managerCandidates(all, "boss").map((m) => m.id)).toEqual(["other"]);
    expect(managerCandidates(all, "lead").map((m) => m.id)).toEqual(["boss", "other"]);
  });

  it("open work can be transferred to any ACTIVE non-guest person except the one leaving", () => {
    expect(transferCandidates(all, "worker").map((m) => m.id)).toEqual(["boss", "lead", "other"]);
    expect(transferCandidates(all, "worker").map((m) => m.id)).not.toContain("partner");
  });
});

describe("the strings the screen builds a key for", () => {
  it("every rank has a one-line description, every status a label, every count form a sentence", () => {
    for (const rank of ["admin", "lead", "member", "guest"]) {
      expect(t(`members.rank_hint_${rank}`), rank).not.toBe(`members.rank_hint_${rank}`);
    }
    for (const status of ["active", "suspended", "offboarded"]) {
      expect(t(`members.status_${status}`), status).not.toBe(`members.status_${status}`);
    }
    for (const form of ["one", "two", "few", "many"]) {
      expect(t(`members.count.${form}`, { n: 7 }), form).not.toBe(`members.count.${form}`);
      for (const unit of ["minute", "hour", "day", "month", "year"]) {
        expect(t(`members.ago.${unit}.${form}`, { n: 7 }), `${unit} ${form}`).not.toBe(`members.ago.${unit}.${form}`);
      }
    }
    // the five ranks have an Arabic name (the new team-lead rank included)
    for (const role of ROLES) expect(t(`role.${role.toLowerCase()}`), role).not.toBe(`role.${role.toLowerCase()}`);
    expect(t("role.lead")).toBe("قائد فريق");
  });
});

describe("the add-person form", () => {
  const valid = {
    ...EMPTY_ADD_FORM,
    name: "  نور الهدى  ",
    username: " Nour.Huda ",
    role: "MEMBER" as const,
  };

  it("starts with the temporary password switched on (generated)", () => {
    expect(EMPTY_ADD_FORM.autoPassword).toBe(true);
    expect(EMPTY_ADD_FORM.role).toBe("MEMBER");
    expect(EMPTY_ADD_FORM.workspaceIds).toEqual([]);
  });

  it("the username is lower-cased and loses its spaces", () => {
    expect(normalizeUsername(" Nour.Huda ")).toBe("nour.huda");
    expect(normalizeUsername("a b  c")).toBe("abc");
  });

  it("accepts a valid form", () => {
    expect(validateAddForm(valid)).toBeNull();
  });

  it("points at the first thing wrong, with an Arabic message key", () => {
    expect(validateAddForm({ ...valid, name: " a " })).toEqual({ field: "name", key: "members.v_name" });
    expect(validateAddForm({ ...valid, username: "ab" })).toEqual({ field: "username", key: "members.v_username" });
    expect(validateAddForm({ ...valid, username: "نور" })).toEqual({ field: "username", key: "members.v_username" });
    // the first character is a letter or a digit; at most 32 characters; no symbols other than . _ -
    expect(validateAddForm({ ...valid, username: ".nour" })).toEqual({ field: "username", key: "members.v_username" });
    expect(validateAddForm({ ...valid, username: "a".repeat(33) })).toEqual({ field: "username", key: "members.v_username" });
    expect(validateAddForm({ ...valid, username: "nour@huda" })).toEqual({ field: "username", key: "members.v_username" });
    expect(validateAddForm({ ...valid, username: "9lives_ok-1.x" })).toBeNull();
    expect(validateAddForm({ ...valid, username: "a".repeat(32) })).toBeNull();
    expect(validateAddForm({ ...valid, email: "nobody" })).toEqual({ field: "email", key: "members.v_email" });
    expect(validateAddForm({ ...valid, email: "nobody@example.test" })).toBeNull();
    expect(validateAddForm({ ...valid, autoPassword: false, password: "short1" })).toEqual({
      field: "password",
      key: "auth.passwordRule",
    });
    expect(validateAddForm({ ...valid, autoPassword: false, password: "Longenough1" })).toBeNull();
    // a typed password is ignored while the switch is on
    expect(validateAddForm({ ...valid, autoPassword: true, password: "x" })).toBeNull();
  });

  it("the typed password rule is 8+ characters with a letter and a digit", () => {
    expect(passwordProblem("abcdefg1")).toBeNull();
    expect(passwordProblem("abcdefgh")).not.toBeNull();
    expect(passwordProblem("12345678")).not.toBeNull();
    expect(passwordProblem("a1")).not.toBeNull();
  });

  it("builds the request for a generated password: no password in it, optional fields left out", () => {
    expect(buildCreatePayload(valid)).toEqual({
      name: "نور الهدى",
      username: "nour.huda",
      role: "MEMBER",
      workspaceIds: [],
    });
  });

  it("builds the request with everything the owner filled in", () => {
    const payload = buildCreatePayload({
      ...valid,
      email: " Nour@Example.Test ",
      jobTitle: " محاسبة ",
      managerId: "boss",
      workspaceIds: ["s1", "s2"],
      autoPassword: false,
      password: "Longenough1",
    });
    expect(payload).toEqual({
      name: "نور الهدى",
      username: "nour.huda",
      role: "MEMBER",
      email: "nour@example.test",
      jobTitle: "محاسبة",
      managerId: "boss",
      workspaceIds: ["s1", "s2"],
      password: "Longenough1",
    });
  });

  it("a guest never gets a manager", () => {
    expect(buildCreatePayload({ ...valid, role: "GUEST", managerId: "boss" })).not.toHaveProperty("managerId");
  });
});

describe("editing a person: only what changed is sent", () => {
  const member = person({ name: "منار", jobTitle: "قائدة فريق", role: "LEAD", managerId: "boss" });
  const same = { name: "منار", jobTitle: "قائدة فريق", role: "LEAD" as const, managerId: "boss" };

  it("nothing changed means nothing to send", () => {
    expect(buildInfoPatch(member, same)).toEqual({});
    expect(buildInfoPatch(member, { ...same, name: "  منار " })).toEqual({});
  });

  it("sends exactly the fields that changed", () => {
    expect(buildInfoPatch(member, { ...same, name: "منار الأحمد" })).toEqual({ name: "منار الأحمد" });
    expect(buildInfoPatch(member, { ...same, role: "MEMBER" })).toEqual({ role: "MEMBER" });
    expect(buildInfoPatch(member, { ...same, jobTitle: "مسؤولة الشحن" })).toEqual({ jobTitle: "مسؤولة الشحن" });
  });

  it("clearing the job title sends an empty string; clearing the manager sends null", () => {
    expect(buildInfoPatch(member, { ...same, jobTitle: "  " })).toEqual({ jobTitle: "" });
    expect(buildInfoPatch(member, { ...same, managerId: "" })).toEqual({ managerId: null });
    expect(buildInfoPatch(person({ managerId: null, jobTitle: null }), { ...same, role: "MEMBER", managerId: "", jobTitle: "" })).toEqual({});
  });

  it("rejects a name that is too short", () => {
    expect(validateInfoForm({ ...same, name: " م " })).toEqual({ field: "name", key: "members.v_name" });
    expect(validateInfoForm(same)).toBeNull();
  });
});

describe("the ready message with the login details", () => {
  it("carries the address, the username, the temporary password and the instruction to change it", () => {
    const msg = buildLoginMessage(t, {
      name: "نور",
      loginUrl: "https://workspace.example.test/login",
      username: "nour",
      password: "Tmp-pass-7",
    });
    expect(msg).toContain("https://workspace.example.test/login");
    expect(msg).toContain("nour");
    expect(msg).toContain("Tmp-pass-7");
    expect(msg).toContain("غيّرها عند أول دخول");
    expect(msg).toContain("نور");
    // one fact per line, so it reads well in a chat
    const lines = msg.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.find((l) => l.includes("nour") && !l.includes("Tmp-pass-7"))).toBeDefined();
    expect(lines.find((l) => l.includes("Tmp-pass-7"))).toBeDefined();
    expect(msg).not.toMatch(/\{[a-z]+\}/); // every placeholder was filled
    expect(msg.endsWith("غيّرها عند أول دخول.") || msg.trimEnd().endsWith("غيّرها عند أول دخول.")).toBe(true);
  });
});

describe("every server error shows in Arabic", () => {
  const err = (status: number, code: string, message?: string, details?: unknown) => new ApiError(code, status, details, message);
  const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);

  it("uses the translation of the key the server sent", () => {
    expect(memberErrorMessage(err(403, "forbidden", "orgm.role_denied"), t)).toBe(t("orgm.role_denied"));
    expect(memberErrorMessage(err(403, "forbidden", "insufficient_role"), t)).toBe(t("insufficient_role"));
    expect(memberErrorMessage(err(404, "not_found", "orgm.not_member"), t)).toBe(t("orgm.not_member"));
  });

  it("never shows a machine key, even for keys nobody translated", () => {
    for (const status of [400, 403, 404, 409, 422, 500]) {
      for (const key of ["accounts.something_new", "x.y.z"]) {
        const text = memberErrorMessage(err(status, "whatever", key), t);
        expect(text, `${status} ${key}`).not.toBe(key);
        expect(text, `${status} ${key}`).not.toMatch(/^[a-z]+(\.[a-z_]+)+$/);
        expect(isArabic(text), `${status} ${key}`).toBe(true);
      }
    }
  });

  it("the errors the owner meets most come out as the account service's own Arabic sentences", () => {
    // 409 conflict for a username in use, 400 bad_request when open work needs a receiver (accounts.ts / _http.ts)
    expect(memberErrorMessage(err(409, "conflict", "accounts.username_taken"), t)).toBe(t("accounts.username_taken"));
    expect(memberErrorMessage(err(400, "bad_request", "accounts.transfer_required"), t)).toBe(t("accounts.transfer_required"));
    expect(memberErrorMessage(err(409, "conflict", "accounts.bad_transition"), t)).toBe(t("accounts.bad_transition"));
    expect(memberErrorMessage(err(403, "forbidden", "accounts.self_denied"), t)).toBe(t("accounts.self_denied"));
    expect(memberErrorMessage(err(403, "forbidden", "accounts.cap_not_held"), t)).toBe(t("accounts.cap_not_held"));
    expect(memberErrorMessage(err(409, "conflict", "email.taken"), t)).toBe(t("email.taken"));
    for (const key of ["accounts.username_taken", "accounts.transfer_required", "accounts.bad_transition", "accounts.self_denied", "accounts.cap_not_held", "email.taken"]) {
      expect(t(key), key).not.toBe(key); // the string exists: a missing one would print the key
    }
  });

  it("a validation answer shows the account service's message for the field that is wrong", () => {
    const text = memberErrorMessage(
      err(422, "validation.failed", "validation.failed", [{ path: "password", message: "accounts.password_digit" }]),
      t,
    );
    expect(text).toBe(t("accounts.password_digit"));
    expect(text).not.toBe(t("members.err_validation"));
  });

  it("validation errors show the first message that has a translation, or a generic one", () => {
    const text = memberErrorMessage(
      err(422, "validation.failed", "validation.failed", [
        { path: "x", message: "not.a.real.key" },
        { path: "name", message: "orgm.no_change" },
      ]),
      t,
    );
    expect(text).toBe(t("orgm.no_change"));
    expect(memberErrorMessage(err(422, "validation.failed", "validation.failed", [{ path: "x", message: "nope.nothing" }]), t)).toBe(
      t("members.err_validation"),
    );
    expect(memberErrorMessage(err(422, "validation.failed", "validation.failed"), t)).toBe(t("members.err_validation"));
  });

  it("falls back on the status when the server sent no usable key", () => {
    expect(memberErrorMessage(err(401, "auth.required"), t)).toBe(t("members.err_session"));
    expect(isArabic(memberErrorMessage(err(401, "auth.required", "auth.required"), t))).toBe(true);
    expect(memberErrorMessage(err(403, "forbidden"), t)).toBe(t("forbidden"));
    expect(memberErrorMessage(err(404, "not_found"), t)).toBe(t("members.err_not_found"));
    expect(memberErrorMessage(err(409, "conflict"), t)).toBe(t("members.err_conflict"));
    expect(memberErrorMessage(err(429, "rate_limited", "auth.too_many_attempts"), t)).toBe(t("auth.too_many_attempts"));
    expect(memberErrorMessage(err(429, "rate_limited"), t)).toBe(t("members.err_rate_limited"));
    expect(memberErrorMessage(err(500, "internal"), t)).toBe(t("common.error"));
  });

  it("a network failure and an unknown thrown value are both explained", () => {
    expect(memberErrorMessage(new TypeError("Failed to fetch"), t)).toBe(t("members.err_network"));
    expect(memberErrorMessage("boom", t)).toBe(t("common.error"));
    expect(memberErrorMessage(undefined, t)).toBe(t("common.error"));
  });
});

describe("the spaces line on a card", () => {
  const ws = (names: string[]) => names.map((name, i) => ({ id: `w${i}`, name, role: "MEMBER" }));

  it("lists the first few and counts the rest", () => {
    expect(spacesSummary(person({ workspaces: ws(["المقر", "الشحن"]) }), t)).toBe("المقر، الشحن");
    expect(spacesSummary(person({ workspaces: ws(["أ", "ب", "ج", "د", "هـ"]) }), t, 3)).toBe(`أ، ب، ج ${t("members.spaces_more", { n: 2 })}`);
  });

  it("says so when there is none, and that the owner is everywhere", () => {
    expect(spacesSummary(person({ workspaces: [] }), t)).toBe(t("members.spaces_none"));
    expect(spacesSummary(person({ role: "OWNER", workspaces: [] }), t)).toBe(t("members.spaces_all"));
  });
});
