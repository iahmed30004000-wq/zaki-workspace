/**
 * S5.5 — «إشارة التوثيق»: the parts that need no database.
 *
 *  - the company switch `verifiedBadge` (name, hint, group, ON by default), the dictionary (Arabic only), the additive migration;
 *  - the ONE badge component («موثّق» as its accessible name) and where it is drawn (chat row, header, bubble, «@» list, dock, people lists, the info panel);
 *  - `presentMessage`: a yes only, never for a guest, never on a system line, never while the company's switch is off, never the time of the grant;
 *  - the OWNER-only door (the rank, not a capability).
 */
import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn, featuresOff } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { MemberCard } from "@/components/members/member-card";
import { StaffDirectory } from "@/components/members/staff-directory";
import { normalizeMember } from "@/lib/members-ui";
import { presentMessage } from "@/server/chat/redact";
import verifiedJson from "@/lib/i18n/ar.verified-badge.json";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const html = (node: ReactNode) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));

describe("the switch and the words", () => {
  it("`verifiedBadge` is a company switch: ON by default, in the chat group, with its name and hint in Arabic", () => {
    expect(FEATURES).toContain("verifiedBadge");
    expect(FEATURE_DEFAULTS.verifiedBadge).toBe(true);
    expect(FEATURE_META.verifiedBadge.group).toBe("chat");
    expect(AR["features.verifiedBadge.name"]).toBe("إشارة التوثيق");
    expect(AR["features.verifiedBadge.hint"]).toMatch(/[؀-ۿ]/);
    // on until the owner turns it off; off when he says so; nothing else listed as off because of it
    expect(featureOn({}, "verifiedBadge")).toBe(true);
    expect(featureOn({ features: { verifiedBadge: false } }, "verifiedBadge")).toBe(false);
    expect(featuresOff({})).not.toContain("verifiedBadge");
    expect(featuresOff({ features: { verifiedBadge: false } })).toContain("verifiedBadge");
  });

  it("every string of the file is Arabic: no Latin letter, no «ـاً» tanween, Western digits only where there are digits", () => {
    for (const [key, value] of Object.entries(verifiedJson)) {
      expect(value, key).toMatch(/[؀-ۿ]/);
      expect(value.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toMatch(/اً/);
      expect(AR[key], `${key} is not registered in dict.ts`).toBe(value);
    }
    expect(AR["verified.name"]).toBe("موثّق");
  });
});

describe("the migration is additive", () => {
  it("is `20261126100000_member_verified`: one nullable column on OrganizationMember, no default, no backfill, nothing dropped", () => {
    const folders = readdirSync(path.join(ROOT, "prisma/migrations"));
    expect(folders).toContain("20261126100000_member_verified");
    const sql = read("prisma/migrations/20261126100000_member_verified/migration.sql");
    const statements = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(statements).toEqual(['ALTER TABLE "OrganizationMember" ADD COLUMN     "verifiedAt" TIMESTAMP(3);']);
    expect(statements.join(" ")).not.toMatch(/NOT NULL|DEFAULT|DROP|UPDATE|DELETE|RENAME|UNIQUE/i);
    expect(read("prisma/schema.prisma")).toMatch(/model OrganizationMember \{[\s\S]*?\n\s+verifiedAt\s+DateTime\?\n[\s\S]*?\n\}/);
  });
});

describe("the one badge", () => {
  it("is a small check mark whose accessible name is «موثّق», drawn from one component", () => {
    const out = html(createElement(VerifiedBadge));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="موثّق"');
    expect(out).toContain("data-verified-badge");
  });

  it("is drawn on every surface of the package, each from `VerifiedBadge`", () => {
    const surfaces: Array<[string, RegExp]> = [
      ["src/components/chat/v2/list/chat-row.tsx", /row\.verified[\s\S]{0,80}<VerifiedBadge/],
      ["src/components/chat/v2/pane/pane-header.tsx", /header\.kind === "DM" && header\.peer\?\.verified \? \([\s\S]{0,300}<VerifiedBadge/],
      ["src/components/chat/v2/message-bubble.tsx", /message\.authorVerified \? <VerifiedBadge/],
      ["src/components/chat/v2/composer/mention-list.tsx", /member\.verified \? <VerifiedBadge/],
      ["src/components/chat/v2/info/info-panel.tsx", /m\.verified \? <VerifiedBadge/],
      ["src/components/shell/people-dock.tsx", /p\.verified \? <VerifiedBadge/],
      ["src/components/members/member-card.tsx", /verified \? <VerifiedBadge/],
      ["src/components/members/staff-directory.tsx", /p\.verified \? <VerifiedBadge/],
    ];
    for (const [file, pattern] of surfaces) expect(read(file), file).toMatch(pattern);
    // the info panel's «الأعضاء» tab draws it too (that file already uses a check icon for finished tasks, so it is not in the one-component loop below)
    expect(read("src/components/chat/v2/info/info-tabs.tsx")).toMatch(/m\.verified \? <VerifiedBadge/);
    // one component: nobody draws a second check mark of their own
    for (const [file] of surfaces) expect(read(file), file).not.toMatch(/BadgeCheck|CheckCircle/);
  });

  it("a member's card draws it next to the name only for a verified person", () => {
    const base = normalizeMember({ id: "u1", name: "سلمى عبيد", role: "MEMBER", status: "ACTIVE" });
    const card = (verified: boolean | undefined) =>
      html(createElement(MemberCard, { member: { ...base, ...(verified === undefined ? {} : { verified }) }, isSelf: false, now: Date.now(), onOpen: () => {} }));
    expect(card(true)).toContain('aria-label="موثّق"');
    expect(card(false)).not.toContain("data-verified-badge");
    expect(card(undefined)).not.toContain("data-verified-badge");
  });

  it("the staff directory draws it next to a verified person's name", () => {
    const t = (key: string) => AR[key] ?? key;
    const people = [
      { id: "a", name: "أحمد", jobTitle: null, role: "MEMBER" as const, email: null, verified: true },
      { id: "b", name: "بسمة", jobTitle: null, role: "MEMBER" as const, email: null },
    ];
    const out = html(createElement(StaffDirectory, { people, t, linkProfiles: false }));
    expect(out.match(/data-verified-badge/g)).toHaveLength(1);
  });
});

describe("the roster keeps the yes", () => {
  it("normalizeMember carries `verified: true` and drops anything else (never `false`, never a time)", () => {
    const base = { id: "u1", name: "x", role: "MEMBER" as const, status: "ACTIVE" as const };
    expect(normalizeMember({ ...base, verified: true }).verified).toBe(true);
    for (const v of [false, undefined, "true", 1, null]) expect(normalizeMember({ ...base, verified: v as never })).not.toHaveProperty("verified");
    expect(normalizeMember({ ...base, verifiedAt: "2026-01-01" } as never)).not.toHaveProperty("verifiedAt");
  });

  it("no surface casts around the type any more: the members' contract, the «@» choice and the sheet read `verified` directly", () => {
    for (const file of ["src/components/members/member-card.tsx", "src/components/members/member-sheet.tsx", "src/components/chat/v2/composer/mention-list.tsx"]) {
      expect(read(file), file).not.toMatch(/& \{ verified\?: boolean \}|as unknown as Partial<ContractMember>/);
    }
    expect(read("src/lib/chat/v2/composer/types.ts")).toMatch(/verified\?: boolean/);
    expect(read("src/lib/members-ui.ts")).toMatch(/verified\?: boolean/);
  });
});

describe("what a message says about its author", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: "m1",
    kind: "TEXT",
    body: "مرحبا",
    createdAt: new Date("2026-11-21T10:00:00Z"),
    pinned: false,
    editedAt: null,
    deletedAt: null,
    orgId: "org1",
    authorId: "u1",
    author: { id: "u1", name: "سلمى", avatarUrl: null, memberships: [{ organizationId: "org1", organization: { settings: {} } }] },
    ...extra,
  });
  const staff = { userId: "viewer", role: "MEMBER", canModerateHere: false };
  const guest = { userId: "viewer", role: "GUEST", canModerateHere: false };

  it("a verified author is a yes for staff, and the DTO holds no time and no granter", () => {
    const dto = presentMessage(row() as never, staff);
    expect(dto.authorVerified).toBe(true);
    expect(JSON.stringify(dto)).not.toMatch(/verifiedAt|grantedBy|verifiedBy/);
  });

  it("an author with no badge, or a badge in another company, says nothing", () => {
    expect(presentMessage(row({ author: { id: "u1", name: "x", avatarUrl: null, memberships: [] } }) as never, staff).authorVerified).toBeUndefined();
    expect(presentMessage(row({ author: { id: "u1", name: "x", avatarUrl: null } }) as never, staff).authorVerified).toBeUndefined();
    expect(presentMessage(row({ author: { id: "u1", name: "x", avatarUrl: null, memberships: [{ organizationId: "other", organization: { settings: {} } }] } }) as never, staff).authorVerified).toBeUndefined();
    // never `false`: a message of an unverified person has no such key at all
    expect("authorVerified" in presentMessage(row({ author: { id: "u1", name: "x", avatarUrl: null, memberships: [] } }) as never, staff)).toBe(false);
  });

  it("a guest reading the same message is told nothing (the badge is no way to read ranks)", () => {
    const dto = presentMessage(row() as never, guest);
    expect("authorVerified" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("verified");
  });

  it("a system line has none, and the company's switch off hides it (the grant stays stored)", () => {
    expect(presentMessage(row({ kind: "SYSTEM", body: JSON.stringify({ k: "join" }) }) as never, staff).authorVerified).toBeUndefined();
    const off = row({ author: { id: "u1", name: "x", avatarUrl: null, memberships: [{ organizationId: "org1", organization: { settings: { features: { verifiedBadge: false } } } }] } });
    expect(presentMessage(off as never, staff).authorVerified).toBeUndefined();
    const on = row({ author: { id: "u1", name: "x", avatarUrl: null, memberships: [{ organizationId: "org1", organization: { settings: { features: { verifiedBadge: true } } } }] } });
    expect(presentMessage(on as never, staff).authorVerified).toBe(true);
  });
});

describe("the door is the owner's rank, never a capability", () => {
  it("`setMemberVerified` checks `isOwner` before anything else and the route goes through it", () => {
    const service = read("src/server/services/org-members.ts");
    const fn = /export async function setMemberVerified[\s\S]*?\n\}\n/.exec(service)![0];
    expect(fn.indexOf("if (!actor.isOwner) throw new ForbiddenError(\"verified.e.owner_only\")")).toBeGreaterThan(0);
    expect(fn).not.toMatch(/assertCan|\.caps\.has|users\.manage/);
    expect(fn.indexOf("isOwner")).toBeLessThan(fn.indexOf("assertFeatureOn"));
    expect(fn).toContain('audit(verified ? "org.member_verified" : "org.member_unverified"');
    const route = read("src/app/api/organizations/[id]/members/[userId]/verify/route.ts");
    expect(route).toContain("setMemberVerified(actor, params.userId, verified)");
    expect(route).not.toMatch(/requireAccountsActor|assertCan/);
  });

  it("the card's control is drawn for the OWNER only, never for a guest's card, and goes through the one route", () => {
    const sheet = read("src/components/members/member-sheet.tsx");
    expect(sheet).toMatch(/actor\.role === "OWNER" && member\.role !== "GUEST" \? <VerifiedSection/);
    expect(sheet).toContain("/verify`");
  });
});

describe("the chat reads the badge without a query of its own per message", () => {
  it("messages join the author's badge once (`messageInclude`), the list reads the peer's inside its one query, the lists use one `IN` query", () => {
    const messages = read("src/server/chat/messages.ts");
    expect(messages).toMatch(/memberships: \{ where: \{ verifiedAt: \{ not: null \}, status: "ACTIVE" \}/);
    const list = read("src/server/chat/list.ts");
    expect(list).toContain('pom."verifiedAt" END AS "peerVerifiedAt"');
    const people = read("src/server/chat/space-people.ts");
    expect(people).toMatch(/userId: \{ in: ids \}, status: "ACTIVE", verifiedAt: \{ not: null \}/);
  });
});
