import { afterEach, describe, expect, it, vi } from "vitest";
import { RANK_DEFAULTS } from "@/server/policy/capabilities";
import { getServerT } from "@/lib/i18n/server";
import { EMPTY_ADD_FORM, normalizeMembersResponse, type ActorInfo, type AddFormValues } from "@/lib/members-ui";
import {
  createMember,
  logoutEverywhere,
  membersApi,
  offboardMember,
  reactivateMember,
  resetCapabilities,
  resetMemberPassword,
  saveMemberInfo,
  setCapability,
  suspendMember,
} from "@/components/members/api";
import { copyText } from "@/components/members/clipboard";
import { ADMIN, LEAD, MEMBER, OWNER_ACTOR, SAMPLE, SUSPENDED, contractMember } from "./members-ui-fixtures";

const { t } = getServerT();
const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);

interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Reply = { status?: number; json?: unknown } | Error;

/** Replaces `fetch`: records every request and answers with whatever the test says. */
function mockFetch(reply: (call: Call) => Reply = () => ({ json: { ok: true } })): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const r = reply(call);
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.json ?? null), {
        status: r.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG = "org1";
const BASE = "/api/organizations/org1/members";

function form(over: Partial<AddFormValues> = {}): AddFormValues {
  return { ...EMPTY_ADD_FORM, name: "نور الهدى", username: "nour.huda", ...over };
}

describe("add a person", () => {
  it("sends the form, asks the server to generate the password, and hands back what to show once", async () => {
    const calls = mockFetch(() => ({ status: 201, json: { userId: "u-9", username: "nour.huda", temporaryPassword: "Tmp-9xq-7" } }));
    const res = await createMember(ORG, form({ workspaceIds: ["s1", "s2"], jobTitle: "محاسبة" }), t);
    expect(calls).toEqual([
      {
        url: BASE,
        method: "POST",
        body: { name: "نور الهدى", username: "nour.huda", role: "MEMBER", jobTitle: "محاسبة", workspaceIds: ["s1", "s2"] },
      },
    ]);
    expect(res).toEqual({ ok: true, value: { userId: "u-9", username: "nour.huda", name: "نور الهدى", password: "Tmp-9xq-7" } });
  });

  it("with a typed password: sends it in the body (never in the address) and shows the same one back", async () => {
    const calls = mockFetch(() => ({ status: 201, json: { userId: "u-9", username: "nour.huda" } }));
    const res = await createMember(ORG, form({ autoPassword: false, password: "Typed-pass-1" }), t);
    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as { password?: string }).password).toBe("Typed-pass-1");
    expect(calls[0]?.url).not.toContain("Typed-pass-1");
    expect(res.ok && res.value.password).toBe("Typed-pass-1");
  });

  it("when the server was meant to generate one and sent none, the password is null, not made up", async () => {
    mockFetch(() => ({ status: 201, json: { userId: "u-9", username: "nour.huda" } }));
    const res = await createMember(ORG, form(), t);
    expect(res.ok && res.value.password).toBeNull();
  });

  it("refuses a bad form before sending anything, and points at the field", async () => {
    const calls = mockFetch();
    const res = await createMember(ORG, form({ username: "x" }), t);
    expect(calls).toHaveLength(0);
    expect(res).toMatchObject({ ok: false, field: "username", code: "client.invalid" });
    expect(!res.ok && res.message).toBe(t("members.v_username"));
    const weak = await createMember(ORG, form({ autoPassword: false, password: "weak" }), t);
    expect(weak).toMatchObject({ ok: false, field: "password" });
    expect(calls).toHaveLength(0);
  });

  it("a taken username comes back as an Arabic sentence (and the key, so the screen can point at the field)", async () => {
    mockFetch(() => ({ status: 409, json: { error: "conflict", message: "accounts.username_taken" } }));
    const res = await createMember(ORG, form(), t);
    expect(res).toMatchObject({ ok: false, code: "conflict", messageKey: "accounts.username_taken" });
    expect(!res.ok && res.message).toBe(t("accounts.username_taken"));
  });

  it("a rank the server refuses is explained in Arabic", async () => {
    mockFetch(() => ({ status: 403, json: { error: "forbidden", message: "orgm.role_denied" } }));
    const res = await createMember(ORG, form({ role: "ADMIN" }), t);
    expect(!res.ok && res.message).toBe(t("orgm.role_denied"));
  });

  it("a network failure is explained too", async () => {
    mockFetch(() => new TypeError("Failed to fetch"));
    const res = await createMember(ORG, form(), t);
    expect(res).toMatchObject({ ok: false, code: "network" });
    expect(!res.ok && res.message).toBe(t("members.err_network"));
  });
});

describe("edit a person", () => {
  it("saves only what changed, to that person's address", async () => {
    const calls = mockFetch();
    const res = await saveMemberInfo(
      ORG,
      LEAD,
      { name: "منار الأحمد", jobTitle: LEAD.jobTitle ?? "", role: "MEMBER", managerId: "" },
      SAMPLE.members,
      OWNER_ACTOR,
      t,
    );
    expect(calls).toEqual([{ url: `${BASE}/u-lead`, method: "PATCH", body: { name: "منار الأحمد", role: "MEMBER", managerId: null } }]);
    expect(res.ok && res.value).toMatchObject({ name: "منار الأحمد", role: "MEMBER", managerId: null, managerName: null });
    // the rank changed, so what the person can do changed: the cache gets the policy's answer
    expect(res.ok && res.value?.effectiveCapabilities).not.toContain("prices.view");
  });

  it("a new manager shows by name at once", async () => {
    mockFetch();
    const res = await saveMemberInfo(ORG, MEMBER, { name: MEMBER.name, jobTitle: "", role: "MEMBER", managerId: "u-lead" }, SAMPLE.members, OWNER_ACTOR, t);
    expect(res.ok && res.value).toMatchObject({ managerId: "u-lead", managerName: "منار" });
  });

  it("clearing the job title sends an empty string and shows no title", async () => {
    const calls = mockFetch();
    const res = await saveMemberInfo(ORG, LEAD, { name: LEAD.name, jobTitle: "  ", role: "LEAD", managerId: "u-admin" }, SAMPLE.members, OWNER_ACTOR, t);
    expect(calls[0]?.body).toEqual({ jobTitle: "" });
    expect(res.ok && res.value).toMatchObject({ jobTitle: null });
  });

  it("sends nothing when nothing changed", async () => {
    const calls = mockFetch();
    const res = await saveMemberInfo(ORG, LEAD, { name: LEAD.name, jobTitle: LEAD.jobTitle ?? "", role: "LEAD", managerId: "u-admin" }, SAMPLE.members, OWNER_ACTOR, t);
    expect(calls).toHaveLength(0);
    expect(res).toEqual({ ok: true, value: null });
  });

  it("refuses a name that is too short, and shows the server's refusal in Arabic", async () => {
    const calls = mockFetch(() => ({ status: 403, json: { error: "forbidden", message: "orgm.role_denied" } }));
    const short = await saveMemberInfo(ORG, LEAD, { name: "م", jobTitle: "", role: "LEAD", managerId: "u-admin" }, SAMPLE.members, OWNER_ACTOR, t);
    expect(short).toMatchObject({ ok: false, field: "name" });
    expect(calls).toHaveLength(0);
    const refused = await saveMemberInfo(ORG, LEAD, { name: "منار", jobTitle: "", role: "ADMIN", managerId: "u-admin" }, SAMPLE.members, OWNER_ACTOR, t);
    expect(!refused.ok && refused.message).toBe(t("orgm.role_denied"));
  });
});

describe("a rank change shows the switches the server turns off", () => {
  // the owner took crm.edit away from this admin: when they re-rank somebody the server does not hand out what they lack
  const adminWithoutCrmEdit: ActorInfo = { id: "u-admin", role: "ADMIN", caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "crm.edit") };
  const guest = contractMember({ id: "u-g", name: "ضيف", role: "GUEST" });
  const toMember = { name: "ضيف", jobTitle: "", role: "MEMBER" as const, managerId: "" };

  it("by somebody who lacks a default of the new rank: it starts switched off, in the cache as on the server", async () => {
    const calls = mockFetch();
    const res = await saveMemberInfo(ORG, guest, toMember, SAMPLE.members, adminWithoutCrmEdit, t);
    expect(calls[0]?.body).toEqual({ role: "MEMBER" }); // the server composes the lists, the screen only asks for the rank
    expect(res.ok && res.value).toMatchObject({ role: "MEMBER", capabilities: [], revokedCapabilities: ["crm.edit"] });
    expect(res.ok && res.value?.effectiveCapabilities).not.toContain("crm.edit");
    expect(res.ok && res.value?.effectiveCapabilities).toContain("crm.view");
  });

  it("by the owner nothing is switched off", async () => {
    mockFetch();
    const res = await saveMemberInfo(ORG, guest, toMember, SAMPLE.members, OWNER_ACTOR, t);
    expect(res.ok && res.value).toMatchObject({ role: "MEMBER", capabilities: [], revokedCapabilities: [] });
    expect(res.ok && res.value?.effectiveCapabilities).toContain("crm.edit");
  });

  it("an explicit extra the person already has survives, and what was revoked stays revoked", async () => {
    mockFetch();
    const noPrices: ActorInfo = { id: "u-admin", role: "ADMIN", caps: RANK_DEFAULTS.ADMIN.filter((c) => c !== "prices.view") };
    const member = contractMember({ id: "u-m", role: "MEMBER", capabilities: ["prices.view"], revokedCapabilities: ["crm.edit"] });
    const res = await saveMemberInfo(ORG, member, { name: member.name, jobTitle: "", role: "LEAD", managerId: "" }, SAMPLE.members, noPrices, t);
    expect(res.ok && res.value).toMatchObject({ role: "LEAD", capabilities: ["prices.view"], revokedCapabilities: ["crm.edit"] });
  });

  it("a rank change that is only a rename sends and patches no switches", async () => {
    mockFetch();
    const res = await saveMemberInfo(ORG, LEAD, { name: "منار الأحمد", jobTitle: LEAD.jobTitle ?? "", role: "LEAD", managerId: "u-admin" }, SAMPLE.members, adminWithoutCrmEdit, t);
    expect(res.ok && res.value).not.toHaveProperty("revokedCapabilities");
    expect(res.ok && res.value).not.toHaveProperty("effectiveCapabilities");
  });
});

describe("capability switches", () => {
  it("one switch is one PATCH with both stored lists, and the cache gets the policy's state", async () => {
    const calls = mockFetch();
    const res = await setCapability(ORG, MEMBER, "integrations.manage", true, t);
    expect(calls).toEqual([
      { url: `${BASE}/u-member`, method: "PATCH", body: { capabilities: ["integrations.manage"], revokedCapabilities: [] } },
    ]);
    expect(res.ok && res.value.effectiveCapabilities).toContain("integrations.manage");
  });

  it("switching off a rank default revokes it", async () => {
    const calls = mockFetch();
    const res = await setCapability(ORG, LEAD, "prices.view", false, t);
    expect(calls[0]?.body).toEqual({ capabilities: [], revokedCapabilities: ["prices.view"] });
    expect(res.ok && res.value.effectiveCapabilities).not.toContain("prices.view");
  });

  it("keeps what the person already had", async () => {
    const calls = mockFetch();
    const person = contractMember({ id: "u-x", role: "MEMBER", capabilities: ["cash.view"], revokedCapabilities: ["crm.edit"] });
    await setCapability(ORG, person, "prices.view", true, t);
    // the lists travel in the catalogue order the server stores them in
    expect(calls[0]?.body).toEqual({ capabilities: ["prices.view", "cash.view"], revokedCapabilities: ["crm.edit"] });
  });

  it("back to the rank's defaults clears the displayed switches and keeps what the screen does not show", async () => {
    const calls = mockFetch();
    const person = contractMember({ id: "u-x", role: "LEAD", capabilities: ["integrations.manage", "penalties.view"], revokedCapabilities: ["crm.edit", "prices.view"] });
    const res = await resetCapabilities(ORG, person, OWNER_ACTOR, t);
    // penalties.view is not on the screen: it stays exactly as stored; prices.view and crm.edit are switches now, so they go back to the rank's default
    expect(calls[0]?.body).toEqual({ capabilities: ["penalties.view"], revokedCapabilities: [] });
    expect(res.ok && res.value.capabilities).toEqual(["penalties.view"]);
    expect(res.ok && res.value.effectiveCapabilities).toContain("crm.edit");
    expect(res.ok && res.value.effectiveCapabilities).not.toContain("integrations.manage");
    expect(res.ok && res.value.effectiveCapabilities).toContain("penalties.view");
    expect(res.ok && res.value.effectiveCapabilities).toContain("prices.view");
  });

  it("somebody who cannot take away an owner's grant leaves it in the lists: the server refuses a request that removes what its sender does not hold", async () => {
    const calls = mockFetch();
    const leadManager: ActorInfo = { id: "u-lead", role: "LEAD", caps: [...RANK_DEFAULTS.LEAD, "users.manage"] };
    const person = contractMember({ id: "u-x", role: "MEMBER", capabilities: ["users.manage", "integrations.manage"] });
    await resetCapabilities(ORG, person, leadManager, t);
    expect(calls[0]?.body).toEqual({ capabilities: ["integrations.manage"], revokedCapabilities: [] });
  });

  it("a capability the actor may not hand out comes back as an Arabic refusal", async () => {
    mockFetch(() => ({ status: 403, json: { error: "forbidden", message: "insufficient_role" } }));
    const res = await setCapability(ORG, MEMBER, "cash.view", true, t);
    expect(!res.ok && res.message).toBe(t("insufficient_role"));
  });
});

describe("suspend, reactivate, offboard, password, sessions", () => {
  it("suspend: POST to the status address", async () => {
    const calls = mockFetch();
    const res = await suspendMember(ORG, MEMBER, t);
    expect(calls).toEqual([{ url: `${BASE}/u-member/status`, method: "POST", body: { action: "suspend" } }]);
    expect(res).toEqual({ ok: true, value: { status: "SUSPENDED" } });
  });

  it("reactivate: hands back the NEW temporary password to show once, and marks it unchanged", async () => {
    const calls = mockFetch(() => ({ json: { ok: true, temporaryPassword: "New-pass-3" } }));
    const res = await reactivateMember(ORG, SUSPENDED, t);
    expect(calls[0]).toEqual({ url: `${BASE}/u-sus/status`, method: "POST", body: { action: "reactivate" } });
    expect(res).toEqual({ ok: true, value: { password: "New-pass-3", patch: { status: "ACTIVE", mustChangePassword: true } } });
  });

  it("offboard with open work needs somebody to hand it to: refused locally without one", async () => {
    const calls = mockFetch();
    const res = await offboardMember(ORG, SUSPENDED, null, t); // two open items
    expect(calls).toHaveLength(0);
    expect(res).toMatchObject({ ok: false, code: "client.invalid" });
    expect(!res.ok && res.message).toBe(t("accounts.transfer_required"));
  });

  it("offboard with a person to receive the work", async () => {
    const calls = mockFetch();
    const res = await offboardMember(ORG, SUSPENDED, "u-lead", t);
    expect(calls).toEqual([{ url: `${BASE}/u-sus/status`, method: "POST", body: { action: "offboard", transferToUserId: "u-lead" } }]);
    expect(res).toEqual({ ok: true, value: { status: "OFFBOARDED", workspaces: [], openWork: 0 } });
  });

  it("offboard without open work sends no transfer target", async () => {
    const calls = mockFetch();
    await offboardMember(ORG, MEMBER, null, t);
    expect(calls[0]?.body).toEqual({ action: "offboard" });
  });

  it("when the list was stale and the server insists on a transfer, the key comes back so the screen can ask for one", async () => {
    // the real answer (accounts.ts through _http.ts): 400 with error "bad_request"
    mockFetch(() => ({ status: 400, json: { error: "bad_request", message: "accounts.transfer_required" } }));
    const res = await offboardMember(ORG, MEMBER, null, t);
    expect(res).toMatchObject({ ok: false, code: "bad_request", messageKey: "accounts.transfer_required" });
    expect(!res.ok && res.message).toBe(t("accounts.transfer_required"));
  });

  it("reset password: POST, and the new temporary password comes back to show once", async () => {
    const calls = mockFetch(() => ({ json: { ok: true, temporaryPassword: "Reset-pass-5" } }));
    const res = await resetMemberPassword(ORG, MEMBER, t);
    expect(calls).toEqual([{ url: `${BASE}/u-member/password`, method: "POST", body: {} }]);
    expect(res).toEqual({ ok: true, value: { password: "Reset-pass-5", patch: { mustChangePassword: true } } });
  });

  it("log out of every device: POST to the logout address", async () => {
    const calls = mockFetch();
    const res = await logoutEverywhere(ORG, ADMIN, t);
    expect(calls).toEqual([{ url: `${BASE}/u-admin/logout`, method: "POST", body: {} }]);
    expect(res).toEqual({ ok: true, value: true });
  });

  it("every refusal is an Arabic sentence", async () => {
    const replies: Reply[] = [
      { status: 403, json: { error: "forbidden", message: "orgm.role_denied" } },
      { status: 404, json: { error: "not_found", message: "orgm.not_member" } },
      { status: 401, json: { error: "auth.required", message: "auth.required" } },
      { status: 500, json: { error: "internal" } },
      new TypeError("Failed to fetch"),
    ];
    for (const reply of replies) {
      mockFetch(() => reply);
      for (const res of [await suspendMember(ORG, MEMBER, t), await resetMemberPassword(ORG, MEMBER, t), await logoutEverywhere(ORG, MEMBER, t)]) {
        expect(res.ok).toBe(false);
        expect(!res.ok && isArabic(res.message)).toBe(true);
        expect(!res.ok && res.message).not.toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      }
    }
  });

  it("a password is never part of an address", async () => {
    const calls = mockFetch(() => ({ json: { ok: true, temporaryPassword: "Secret-pass-8" } }));
    await reactivateMember(ORG, SUSPENDED, t);
    await resetMemberPassword(ORG, MEMBER, t);
    for (const call of calls) expect(call.url).not.toContain("Secret-pass-8");
  });
});

describe("loading the list", () => {
  it("GETs the members address and fills in what a partial answer leaves out", async () => {
    const calls = mockFetch(() => ({
      json: {
        members: [{ id: "u-1", name: "منار", role: "LEAD", status: "WEIRD" }, { id: "u-2", name: "قبس", role: "ROOT", capabilities: ["crm.view", 7] }],
        actorRole: "OWNER",
      },
    }));
    const data = await membersApi.list(ORG);
    expect(calls).toEqual([{ url: BASE, method: "GET", body: undefined }]);
    expect(data.spaces).toEqual([]);
    const [first, second] = data.members;
    expect(first).toMatchObject({ id: "u-1", status: "ACTIVE", workspaces: [], openWork: 0, mustChangePassword: false, capabilities: [] });
    expect(first?.effectiveCapabilities).toContain("prices.view"); // a team lead's default
    // an unknown rank is read as the least-privileged one, never as something powerful
    expect(second).toMatchObject({ role: "GUEST", capabilities: ["crm.view"] });
    expect(second?.effectiveCapabilities).toEqual([]);
  });

  it("an empty or broken answer is an empty list, not a crash", () => {
    expect(normalizeMembersResponse(null)).toEqual({ members: [], actorRole: "GUEST", actorPrimaryOwner: false, spaces: [] });
    expect(normalizeMembersResponse({} as never)).toEqual({ members: [], actorRole: "GUEST", actorPrimaryOwner: false, spaces: [] });
  });

  it("encodes a person's id in the address", async () => {
    const calls = mockFetch();
    await suspendMember(ORG, contractMember({ id: "a/b c" }), t);
    expect(calls[0]?.url).toBe(`${BASE}/a%2Fb%20c/status`);
  });
});

describe("copying to the clipboard", () => {
  it("uses the clipboard API when there is one", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  function fakeDocument(execCommand: () => boolean) {
    const field = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn() };
    const body = { appendChild: vi.fn(), removeChild: vi.fn() };
    const previous = { focus: vi.fn() };
    vi.stubGlobal("document", { body, createElement: vi.fn(() => field), execCommand: vi.fn(execCommand), activeElement: previous });
    return { field, body, previous };
  }

  it("falls back to select-and-copy when the clipboard API refuses, and cleans up after itself", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const dom = fakeDocument(() => true);
    expect(await copyText("hello")).toBe(true);
    expect(dom.field.value).toBe("hello");
    expect(dom.body.appendChild).toHaveBeenCalledWith(dom.field);
    expect(dom.body.removeChild).toHaveBeenCalledWith(dom.field);
    expect(dom.previous.focus).toHaveBeenCalled(); // focus goes back to where it was
  });

  it("says so when nothing worked", async () => {
    vi.stubGlobal("navigator", {});
    fakeDocument(() => false);
    expect(await copyText("hello")).toBe(false);
    vi.stubGlobal("document", undefined);
    expect(await copyText("hello")).toBe(false);
  });
});
