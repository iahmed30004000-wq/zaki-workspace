import { describe, expect, it } from "vitest";
import type { OrgRole } from "@prisma/client";
import { PEOPLE_SCOPE_DEPTH, hasTeam, inTeam, reportsFromLines, teamScopeInfoOf, teamTaskWhere, type LineRow, type PeopleScope } from "@/server/policy/people-scope";

/**
 * A2.3 — «فريقي» has ONE meaning: everybody under me in the reporting line (managerId, transitive, ACTIVE, depth ≤ 6).
 * This file is the pure half: the walk and the small helpers built on it. The database half is tests/db/people-scope.test.ts.
 */

const row = (userId: string, managerId: string | null, role: OrgRole = "MEMBER", status = "ACTIVE"): LineRow => ({ userId, managerId, role, status });
const scope = (kind: PeopleScope["kind"], ids: string[] = []): PeopleScope => ({ orgId: "o", viewerId: "me", kind, reportIds: new Set(ids) });

describe("reportsFromLines — my team", () => {
  it("is everybody under the person, direct and indirect, and never the person themselves", () => {
    const lines = [row("me", null, "ADMIN"), row("a", "me"), row("b", "me"), row("c", "a"), row("d", "c"), row("x", null)];
    expect(reportsFromLines(lines, "me").sort()).toEqual(["a", "b", "c", "d"]);
    expect(reportsFromLines(lines, "a").sort()).toEqual(["c", "d"]);
    expect(reportsFromLines(lines, "d")).toEqual([]);
    expect(reportsFromLines(lines, "x")).toEqual([]);
  });

  it("lists ACTIVE staff only: a suspended or offboarded person is not listed, but the people under them still are", () => {
    const lines = [row("me", null), row("s", "me", "MEMBER", "SUSPENDED"), row("o", "me", "MEMBER", "OFFBOARDED"), row("under", "s"), row("under2", "o")];
    expect(reportsFromLines(lines, "me").sort()).toEqual(["under", "under2"]);
  });

  it("never lists a guest or an OWNER rank", () => {
    const lines = [row("me", null), row("g", "me", "GUEST"), row("w", "me", "OWNER"), row("m", "me", "LEAD")];
    expect(reportsFromLines(lines, "me")).toEqual(["m"]);
  });

  it("stops at the depth cap: six levels below, not seven", () => {
    expect(PEOPLE_SCOPE_DEPTH).toBe(6);
    const chain: LineRow[] = [row("p0", null)];
    for (let i = 1; i <= 8; i += 1) chain.push(row(`p${i}`, `p${i - 1}`));
    const found = reportsFromLines(chain, "p0");
    expect(found).toHaveLength(6);
    expect(found).toContain("p6");
    expect(found).not.toContain("p7");
    expect(reportsFromLines(chain, "p0", 2)).toEqual(["p1", "p2"]);
  });

  it("ends on a loop in bad data and lists a person once", () => {
    const lines = [row("me", "c"), row("a", "me"), row("b", "a"), row("c", "b")];
    expect(reportsFromLines(lines, "me").sort()).toEqual(["a", "b", "c"]);
    const diamond = [row("me", null), row("a", "me"), row("a", "a")];
    expect(reportsFromLines(diamond, "me")).toEqual(["a"]);
  });
});

describe("the helpers built on the scope", () => {
  it("a person with no team has no card: «none» is not «company» and not an empty team", () => {
    expect(hasTeam(scope("none"))).toBe(false);
    expect(hasTeam(scope("reports", ["a"]))).toBe(true);
    expect(hasTeam(scope("company"))).toBe(true);
    expect(teamScopeInfoOf(scope("none"))).toBeNull();
  });

  it("says what was counted: the company, or my team, and the space when the page narrowed to one", () => {
    expect(teamScopeInfoOf(scope("company"))).toEqual({ who: "company", spaceName: null });
    expect(teamScopeInfoOf(scope("reports", ["a"]), "مساحة أ")).toEqual({ who: "reports", spaceName: "مساحة أ" });
  });

  it("inTeam: the company is everybody; a team is exactly its people", () => {
    expect(inTeam(scope("company"), "anybody")).toBe(true);
    expect(inTeam(scope("reports", ["a"]), "a")).toBe(true);
    expect(inTeam(scope("reports", ["a"]), "b")).toBe(false);
    expect(inTeam(scope("none"), "a")).toBe(false);
  });

  it("teamTaskWhere: nothing for the company, the people's tasks (and co-assignments) for a team, and NOTHING for nobody", () => {
    expect(teamTaskWhere(scope("company"))).toEqual({});
    expect(teamTaskWhere(scope("none"))).toEqual({ id: { in: [] } });
    expect(teamTaskWhere(scope("reports", []))).toEqual({ id: { in: [] } });
    expect(teamTaskWhere(scope("reports", ["a", "b"]))).toEqual({
      OR: [{ assigneeId: { in: ["a", "b"] } }, { coAssignees: { some: { userId: { in: ["a", "b"] } } } }],
    });
  });
});
