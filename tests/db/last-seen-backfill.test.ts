import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db, makeTeam } from "./helpers";

/**
 * «آخر ظهور» for the people who were here before it was recorded: the migration gives every ACTIVE member with no time
 * the latest sign-in or message of theirs in that company, and touches nobody else.
 */
const SQL = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261109100000_last_seen_backfill/migration.sql"), "utf8");

async function run(): Promise<void> {
  // the file is comments plus one statement
  await db.$executeRawUnsafe(SQL.replace(/^--.*$/gm, ""));
}
async function seenOf(orgId: string, userId: string): Promise<Date | null> {
  const row = await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { lastSeenAt: true } });
  return row.lastSeenAt;
}

describe("the «آخر ظهور» backfill", () => {
  it("takes the latest of a sign-in and a written message, keeps a recorded time, skips a system line and a stranger's sign-in", async () => {
    const t = await makeTeam();
    const other = await makeTeam();
    const at = (iso: string) => new Date(iso);
    const conv = await db.conversation.create({
      data: { orgId: t.org.id, kind: "GROUP", title: "Lounge", members: { create: [{ userId: t.owner.id, role: "admin" }, { userId: t.admin.id }, { userId: t.member.id }] } },
    });

    // admin: a sign-in on the 1st, a message on the 3rd -> the 3rd
    await db.auditLog.create({ data: { actorId: t.admin.id, orgId: t.org.id, action: "auth.login", createdAt: at("2026-10-01T08:00:00Z") } });
    await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: conv.id, authorId: t.admin.id, body: "hi", createdAt: at("2026-10-03T09:00:00Z") } });
    // a sign-in AFTER the message wins, and a sign-in of the same person in ANOTHER company does not count
    await db.auditLog.create({ data: { actorId: t.admin.id, orgId: t.org.id, action: "auth.login", createdAt: at("2026-10-05T10:00:00Z") } });
    await db.auditLog.create({ data: { actorId: t.admin.id, orgId: other.org.id, action: "auth.login", createdAt: at("2026-10-20T10:00:00Z") } });
    // member: only a system line -> nothing to go on, stays null
    await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: conv.id, authorId: t.member.id, kind: "SYSTEM", body: "joined", createdAt: at("2026-10-04T09:00:00Z") } });
    // owner already has a recorded time (later than anything else): untouched
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: t.owner.id } }, data: { lastSeenAt: at("2026-10-02T00:00:00Z") } });
    await db.auditLog.create({ data: { actorId: t.owner.id, orgId: t.org.id, action: "auth.login", createdAt: at("2026-10-09T00:00:00Z") } });

    await run();
    expect((await seenOf(t.org.id, t.admin.id))?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();
    expect((await seenOf(t.org.id, t.owner.id))?.toISOString()).toBe("2026-10-02T00:00:00.000Z");

    // a second run changes nothing
    await run();
    expect((await seenOf(t.org.id, t.admin.id))?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("leaves somebody who is no longer ACTIVE alone", async () => {
    const t = await makeTeam();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } }, data: { status: "SUSPENDED" } });
    await db.auditLog.create({ data: { actorId: t.member.id, orgId: t.org.id, action: "auth.login" } });
    await run();
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();
  });
});
