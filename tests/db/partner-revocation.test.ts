/**
 * A1.3 — «one meaning per rule»: a PARTNER's revoked permission works on every surface, not only in chat.
 *
 * A partner is an OWNER-rank person who is not the primary owner: the primary owner takes permissions away from him one by
 * one (`revokedCapabilities`). Before this step several doors decided by `role === "OWNER"` and so ignored the revocation
 * (docs/restructure/A1-permissions-and-panels.md §1.5). One test per site: revoke → refused; the primary owner unchanged.
 *
 * Not here on purpose (D-A4, still «بانتظار المالك»): who flips the company's switches and the permanent chat purge stay
 * at the OWNER rank.
 */
import "./scoping-react";
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

import * as workspacesRoute from "@/app/api/workspaces/route";
import * as overviewRoute from "@/app/api/owner-board/route";
import * as lineRoute from "@/app/api/team-development/lines/[userId]/route";
import * as skillsRoute from "@/app/api/team-development/skills/route";
import * as notesRoute from "@/app/api/team-development/people/[id]/notes/route";
import { boardAccess } from "@/server/policy/board";
import { devAccess, mayEnterFor } from "@/server/policy/team-development";
import { canEditRewardTask, canSetReward } from "@/server/policy/reward";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { requireActor } from "@/server/policy/actor";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";

/** One company: the primary owner, a partner (OWNER rank, not primary), an admin, two members. */
async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const partner = await makeUser({ orgId, role: "OWNER", name: "شريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: partner.id } }, data: { primaryOwner: false } });
  const other = await makeUser({ orgId, role: "MEMBER", name: "موظف ثاني" });
  return { ...t, orgId, partner, other };
}
type World = Awaited<ReturnType<typeof world>>;

/** The primary owner takes these permissions away from the partner (the stored list is what the sheet's switches write). */
const revoke = (w: World, ...caps: string[]) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.partner.id } }, data: { revokedCapabilities: caps } });

async function boardAs(userId: string) {
  await loginAs(userId);
  return boardAccess(await requireActor());
}
async function devAs(userId: string) {
  await loginAs(userId);
  return devAccess(await requireActor());
}

describe("«لوحة المالك»: policy/board.ts follows board.team and board.self", () => {
  it("a partner with board.team is the owner view; without it he is on his own page; without both, 404; the primary owner is unchanged", async () => {
    const w = await world();
    expect((await boardAs(w.partner.id)).mode).toBe("owner");

    await revoke(w, "board.team");
    const own = await boardAs(w.partner.id);
    expect(own.mode).toBe("self");
    expect(own.companyWide).toBe(false);
    expect(own.reach?.size).toBe(0);

    await revoke(w, "board.team", "board.self");
    await expect(boardAs(w.partner.id)).rejects.toThrow("ownerboard.not_found");
    await loginAs(w.partner.id);
    expect((await call(overviewRoute.GET, { url: "http://localhost/api/owner-board" })).status).toBe(404);

    const primary = await boardAs(w.owner.id);
    expect(primary).toMatchObject({ mode: "owner", companyWide: true, reach: null });
    await loginAs(w.owner.id);
    expect((await call(overviewRoute.GET, { url: "http://localhost/api/owner-board" })).status).toBe(200);
  });
});

describe("«الأداء والتطوير»: policy/team-development.ts follows people.manage_lines and people.review", () => {
  it("a partner without people.manage_lines cannot set a line or touch the skills catalogue (404); the primary owner can", async () => {
    const w = await world();
    await loginAs(w.partner.id);
    expect((await call(lineRoute.PUT, { method: "PUT", body: { managerId: w.admin.id }, params: { userId: w.member.id } })).status).toBe(200);

    await revoke(w, "people.manage_lines");
    expect((await devAs(w.partner.id)).canManageLines).toBe(false);
    await loginAs(w.partner.id);
    expect((await call(lineRoute.PUT, { method: "PUT", body: { managerId: w.other.id }, params: { userId: w.member.id } })).status).toBe(404);
    expect((await call(skillsRoute.POST, { body: { name: "مهارة" } })).status).toBe(404);
    expect((await db.organizationMember.findFirstOrThrow({ where: { organizationId: w.orgId, userId: w.member.id } })).managerId).toBe(w.admin.id);

    expect((await devAs(w.owner.id)).canManageLines).toBe(true);
    await loginAs(w.owner.id);
    expect((await call(lineRoute.PUT, { method: "PUT", body: { managerId: w.other.id }, params: { userId: w.member.id } })).status).toBe(200);
  });

  it("a partner without people.review cannot enter a note about somebody (403); he still reads; the primary owner can", async () => {
    const w = await world();
    await loginAs(w.partner.id);
    expect((await call(notesRoute.POST, { body: { body: "ملاحظة" }, params: { id: w.member.id } })).status).toBe(201);

    await revoke(w, "people.review");
    const access = await devAs(w.partner.id);
    expect(access.canReview).toBe(false);
    expect(mayEnterFor(access, w.member.id)).toBe(false);
    expect(access.reach).toBeNull(); // reading stays the owner rank's
    await loginAs(w.partner.id);
    expect((await call(notesRoute.POST, { body: { body: "ملاحظة ثانية" }, params: { id: w.member.id } })).status).toBe(403);
    expect(await db.reviewNote.count({ where: { organizationId: w.orgId, userId: w.member.id } })).toBe(1);

    const primary = await devAs(w.owner.id);
    expect(primary.canReview).toBe(true);
    expect(mayEnterFor(primary, w.member.id)).toBe(true);
    await loginAs(w.owner.id);
    expect((await call(notesRoute.POST, { body: { body: "من المالك" }, params: { id: w.member.id } })).status).toBe(201);
  });
});

describe("the spaces switcher: canCreateSpaces is spaces.create", () => {
  const flag = async (userId: string) => {
    await loginAs(userId);
    const res = await call(workspacesRoute.GET, { url: "http://localhost/api/workspaces" });
    expect(res.status).toBe(200);
    const orgs = res.json?.["organizations"] as { canCreateSpaces: boolean }[];
    return orgs[0]?.canCreateSpaces;
  };

  it("revoking spaces.create from a partner turns the flag off AND refuses the door; the primary owner is unchanged", async () => {
    const w = await world();
    expect(await flag(w.partner.id)).toBe(true);
    await revoke(w, "spaces.create");
    expect(await flag(w.partner.id)).toBe(false);
    await loginAs(w.partner.id);
    expect((await call(workspacesRoute.POST, { body: { name: "مساحة" } })).status).toBe(403);
    expect(await flag(w.owner.id)).toBe(true);
    await loginAs(w.owner.id);
    expect((await call(workspacesRoute.POST, { body: { name: "مساحة المالك" } })).status).toBe(201);
  });
});

describe("«مهمة بمكافأة»: policy/reward.ts asks for the section's capability (tasks.edit) besides the OWNER rank", () => {
  const caps = (revoked: string[]) => effectiveCapabilities({ role: "OWNER", primaryOwner: false, revokedCapabilities: revoked });
  const ownerOnly = { rewardStatus: "OPEN" };

  it("a partner who lost tasks.edit sets no reward and edits no reward task; a partner who keeps it, the primary owner and the old callers (no caps given) are unchanged", () => {
    const kept = caps([]);
    const lost = caps(["tasks.edit"]);
    expect(canSetReward({ isOwner: true, caps: kept })).toBe(true);
    expect(canSetReward({ isOwner: true, caps: lost })).toBe(false);
    expect(canEditRewardTask({ isOwner: true, caps: lost }, ownerOnly)).toBe(false);
    expect(canEditRewardTask({ isOwner: true, caps: kept }, ownerOnly)).toBe(true);
    // a plain task (no reward) is nobody's lock
    expect(canEditRewardTask({ isOwner: true, caps: lost }, { rewardStatus: null })).toBe(true);
    // the primary owner holds everything
    expect(canSetReward({ isOwner: true, caps: effectiveCapabilities({ role: "OWNER", primaryOwner: true }) })).toBe(true);
    // a caller that does not pass caps (today's callers) is read as before: the rank decides
    expect(canSetReward({ isOwner: true })).toBe(true);
    expect(canSetReward({ isOwner: false })).toBe(false);
    // an ADMIN is never an owner, whatever he holds
    expect(canSetReward({ isOwner: false, caps: effectiveCapabilities({ role: "ADMIN" }) })).toBe(false);
  });
});
