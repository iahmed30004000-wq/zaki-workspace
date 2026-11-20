/**
 * A1.3 — ONE service path and ONE picker for `OrganizationMember.managerId` (D-A5, still «بانتظار المالك»: built with the
 * recommended default «yes»).
 *
 *  - «الهيكل» (`team-lines.ts`) delegates to the accounts rank limit: a line is changed only for somebody the caller outranks, with
 *    the SAME refusal the people screen gives (403 `orgm.role_denied`). Before this step «الهيكل» had no rank limit at all, so a
 *    holder of `people.manage_lines` could move his own superior.
 *  - the people sheet, the add-person sheet and «الهيكل» draw ONE `ManagerPicker`, with one empty label «بدون مسؤول مباشر».
 */
import "./scoping-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

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

import * as linesRoute from "@/app/api/team-development/lines/route";
import * as lineRoute from "@/app/api/team-development/lines/[userId]/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import StructurePage from "@/app/(app)/structure/page";
import { ManagerPicker } from "@/components/members/manager-picker";
import { ManagerLine } from "@/components/structure/manager-line";
import { getServerT } from "@/lib/i18n/server";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";
import { html } from "./today-helpers";

const { t } = getServerT();
const NONE = "بدون مسؤول مباشر";

async function world() {
  const t0 = await makeTeam();
  const orgId = t0.org.id;
  const mk = (name: string, role: "ADMIN" | "LEAD" | "MEMBER" = "MEMBER") => makeUser({ orgId, role, name });
  const admin2 = await mk("مشرف ثاني", "ADMIN");
  const lead = await mk("قائد", "LEAD");
  const member2 = await mk("موظف ثاني");
  const boss = await mk("المسؤول");
  const partner = await makeUser({ orgId, role: "OWNER", name: "شريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: partner.id } }, data: { primaryOwner: false } });
  return { ...t0, orgId, admin2, lead, member2, boss, partner };
}
type World = Awaited<ReturnType<typeof world>>;

const grant = (w: World, userId: string, capabilities: string[]) =>
  db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId } }, data: { capabilities } });
const setLine = (userId: string, managerId: string | null) => call(lineRoute.PUT, { method: "PUT", body: { managerId }, params: { userId } });
const lineOf = async (w: World, userId: string) => (await db.organizationMember.findFirstOrThrow({ where: { organizationId: w.orgId, userId } })).managerId;

describe("«الهيكل» applies the people screen's rank limit", () => {
  it("an admin who holds people.manage_lines moves a lead and a member, never another admin; the refusal is the people screen's own (403 orgm.role_denied)", async () => {
    const w = await world();
    await grant(w, w.admin.id, ["people.manage_lines"]);
    await loginAs(w.admin.id);
    expect((await setLine(w.lead.id, w.boss.id)).status).toBe(200);
    expect((await setLine(w.member2.id, w.lead.id)).status).toBe(200);
    expect(await lineOf(w, w.member2.id)).toBe(w.lead.id);

    const peer = await setLine(w.admin2.id, w.boss.id);
    expect(peer.status).toBe(403);
    expect(JSON.stringify(peer.json)).toContain("orgm.role_denied");
    expect(await lineOf(w, w.admin2.id)).toBeNull();

    // the people screen's door says the same for the same pair
    const screen = await call(memberRoute.PATCH, { method: "PATCH", params: { id: w.orgId, userId: w.admin2.id }, body: { managerId: w.boss.id } });
    expect(screen.status).toBe(403);
    expect(JSON.stringify(screen.json)).toContain("orgm.role_denied");
  });

  it("a member who was given people.manage_lines outranks nobody on the tree: refused with 403, the line is untouched", async () => {
    const w = await world();
    await grant(w, w.member.id, ["people.manage_lines"]);
    await loginAs(w.member.id);
    for (const target of [w.lead, w.member2, w.admin2]) {
      const res = await setLine(target.id, w.boss.id);
      expect(res.status, target.name).toBe(403);
      expect(await lineOf(w, target.id), target.name).toBeNull();
    }
  });

  it("the primary owner and a partner are unchanged: they move an admin, a lead and a member", async () => {
    const w = await world();
    for (const who of [w.owner, w.partner]) {
      await loginAs(who.id);
      for (const target of [w.admin2, w.lead, w.member2]) {
        expect((await setLine(target.id, w.boss.id)).status, who.name).toBe(200);
        expect((await setLine(target.id, null)).status).toBe(200);
      }
    }
  });

  it("the tree only offers «غيّر المسؤول» where the server would accept it (node.canEdit)", async () => {
    const w = await world();
    await grant(w, w.admin.id, ["people.manage_lines"]);
    await loginAs(w.admin.id);
    const res = await call(linesRoute.GET, { url: "http://localhost/api/team-development" });
    const nodes = (res.json?.["structure"] as { nodes: { userId: string; canEdit: boolean }[] }).nodes;
    const can = (id: string) => nodes.find((n) => n.userId === id)?.canEdit;
    expect(can(w.lead.id)).toBe(true);
    expect(can(w.member2.id)).toBe(true);
    expect(can(w.admin2.id)).toBe(false); // a peer
    expect(can(w.admin.id)).toBe(false); // himself, an admin
    expect(can(w.owner.id)).toBe(false); // the owner has no supervisor

    const page = await html(StructurePage());
    expect(page).toContain(`data-change-supervisor="${w.lead.id}"`);
    expect(page).not.toContain(`data-change-supervisor="${w.admin2.id}"`);
    expect(page).not.toContain(`data-change-supervisor="${w.owner.id}"`);

    await loginAs(w.owner.id);
    const all = (await call(linesRoute.GET, { url: "http://localhost/api/team-development" })).json?.["structure"] as { nodes: { userId: string; canEdit: boolean }[] };
    expect(all.nodes.find((n) => n.userId === w.admin2.id)?.canEdit).toBe(true);
    expect(all.nodes.find((n) => n.userId === w.owner.id)?.canEdit).toBe(false);
  });
});

describe("ONE ManagerPicker, ONE empty label", () => {
  const people = [
    { id: "p1", name: "عبد الله", role: "MEMBER" },
    { id: "p2", name: "منار", role: "LEAD" },
  ];

  it("the empty option is «بدون مسؤول مباشر», the people follow as «name — rank», a manager who left stays visible", async () => {
    const markup = await html(createElement(ManagerPicker, { id: "m", value: "gone", onChange: () => {}, options: people, current: { id: "gone", name: "راما" } }));
    expect(markup).toContain(`>${NONE}</option>`);
    expect(markup.split(NONE).length - 1).toBe(1);
    expect(markup).toContain("عبد الله — عضو");
    expect(markup).toContain("منار — قائد فريق");
    expect(markup).toContain(">راما</option>");
    // the label is the dictionary's key the people screen's tests already name
    expect(t("members.manager_owner")).toBe(NONE);
  });

  it("«الهيكل» draws the same picker (same empty label, same «name — rank» lines)", async () => {
    const markup = await html(createElement(ManagerLine, { userId: "u1", name: "موظف", current: null, options: people, defaultOpen: true }));
    expect(markup).toContain(`>${NONE}</option>`);
    expect(markup).toContain("منار — قائد فريق");
    expect(markup).toContain("data-manager-picker");
  });

  it("the three screens use the component and none of them keeps its own empty option or its own old label", () => {
    const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
    for (const rel of ["src/components/members/member-sheet.tsx", "src/components/members/add-member-sheet.tsx", "src/components/structure/manager-line.tsx"]) {
      const source = read(rel);
      expect(source, rel).toContain("<ManagerPicker");
      expect(source, rel).not.toContain("members.manager_owner"); // the empty option belongs to the picker alone
    }
    expect(read("src/components/structure/structure-tree.tsx")).not.toContain("SupervisorPicker");
    expect(read("src/lib/i18n/ar.members.json")).not.toContain("المالك (الافتراضي)");
  });
});
