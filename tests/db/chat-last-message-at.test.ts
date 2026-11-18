import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as pinRoute from "@/app/api/chat/messages/[id]/pin/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * C1.1: `Conversation.lastMessageAt` (the newest message that is not deleted), its backfill and the message
 * cursor index.
 *
 * The column is read with plain SQL on purpose: these tests stand on the database, not on the generated client.
 */

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const COLUMN = "20261119100000_conversation_last_message_at";
const BACKFILL = "20261119100100_conversation_last_message_at_backfill";
const MESSAGE_INDEX = "20261119100200_chat_message_cursor_index";

let t: Awaited<ReturnType<typeof makeTeam>>;
let topicId: string;
let dmId: string;

beforeEach(async () => {
  t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }]);
  topicId = (await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "عام" } })).id;
  dmId = (await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", dmKey: [t.member.id, t.admin.id].sort().join("|") } })).id;
  await db.conversationMember.createMany({
    data: [
      { conversationId: dmId, userId: t.member.id },
      { conversationId: dmId, userId: t.admin.id },
    ],
  });
});

async function lastAt(conversationId: string): Promise<Date | null> {
  const rows = await db.$queryRaw<{ lastMessageAt: Date | null }[]>`SELECT "lastMessageAt" FROM "Conversation" WHERE "id" = ${conversationId}`;
  return rows[0]!.lastMessageAt;
}

async function setLastAt(conversationId: string, at: Date | null): Promise<void> {
  await db.$executeRaw`UPDATE "Conversation" SET "lastMessageAt" = ${at} WHERE "id" = ${conversationId}`;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function plant(conversationId: string, createdAt: Date, extra: { deletedAt?: Date } = {}) {
  return db.chatMessage.create({
    data: { orgId: t.org.id, conversationId, authorId: t.member.id, body: "نص", createdAt, ...(extra.deletedAt ? { deletedAt: extra.deletedAt, deletedById: t.member.id } : {}) },
  });
}

async function send(conversationId: string, body: string) {
  const res = await call(conversationMessagesRoute.POST, { params: { id: conversationId }, body: { body } });
  expect(res.status).toBe(201);
  return res.json as { id: string };
}

async function remove(messageId: string) {
  const res = await call(messageRoute.DELETE, { method: "DELETE", params: { id: messageId } });
  expect(res.status).toBeLessThan(300);
}

describe("C1.1: the column and the indexes exist", () => {
  it("Conversation.lastMessageAt is a nullable timestamp(3) with an index on (orgId, lastMessageAt)", async () => {
    const col = await db.$queryRaw<{ data_type: string; is_nullable: string; datetime_precision: number }[]>`
      SELECT data_type, is_nullable, datetime_precision FROM information_schema.columns
      WHERE table_name = 'Conversation' AND column_name = 'lastMessageAt'`;
    expect(col).toHaveLength(1);
    expect(col[0]!.data_type).toBe("timestamp without time zone");
    expect(col[0]!.is_nullable).toBe("YES");
    expect(col[0]!.datetime_precision).toBe(3);
    const idx = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'Conversation' AND indexdef LIKE '%lastMessageAt%'`;
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toContain('("orgId", "lastMessageAt")');
  });

  it("ChatMessage has the (conversationId, createdAt, id) index for the cursor", async () => {
    const idx = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'ChatMessage' AND indexdef LIKE '%("conversationId", "createdAt", id)%'`;
    expect(idx).toHaveLength(1);
  });

  it("the three changes live in three folders", () => {
    for (const folder of [COLUMN, BACKFILL, MESSAGE_INDEX]) {
      expect(readFileSync(path.join(MIGRATIONS, folder, "migration.sql"), "utf8").length, folder).toBeGreaterThan(0);
    }
    expect(readFileSync(path.join(MIGRATIONS, COLUMN, "migration.sql"), "utf8")).not.toMatch(/\bUPDATE\b/i);
    expect(readFileSync(path.join(MIGRATIONS, BACKFILL, "migration.sql"), "utf8")).not.toMatch(/\b(ALTER|CREATE)\b/i);
  });
});

describe("C1.1: sending writes lastMessageAt in the same transaction", () => {
  it("a new conversation has none; every send moves it to the new message's time", async () => {
    expect(await lastAt(topicId)).toBeNull();
    await loginAs(t.member.id);
    const first = await send(topicId, "الأولى");
    const firstRow = await db.chatMessage.findUniqueOrThrow({ where: { id: first.id } });
    expect((await lastAt(topicId))?.getTime()).toBe(firstRow.createdAt.getTime());
    await new Promise((r) => setTimeout(r, 5));
    const second = await send(topicId, "الثانية");
    const secondRow = await db.chatMessage.findUniqueOrThrow({ where: { id: second.id } });
    expect((await lastAt(topicId))?.getTime()).toBe(secondRow.createdAt.getTime());
    expect(secondRow.createdAt.getTime()).toBeGreaterThan(firstRow.createdAt.getTime());
  });

  it("works for a DM too and touches no other conversation", async () => {
    await loginAs(t.member.id);
    const m = await send(dmId, "مرحبا");
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect((await lastAt(dmId))?.getTime()).toBe(row.createdAt.getTime());
    expect(await lastAt(topicId)).toBeNull();
  });

  it("a retry with the same clientId does not move it", async () => {
    await loginAs(t.member.id);
    const res = await call(conversationMessagesRoute.POST, { params: { id: topicId }, body: { body: "مرة", clientId: "c11-retry" } });
    expect(res.status).toBe(201);
    const stamp = await lastAt(topicId);
    expect(stamp).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const again = await call(conversationMessagesRoute.POST, { params: { id: topicId }, body: { body: "مرة", clientId: "c11-retry" } });
    expect(again.status).toBe(201);
    expect((await lastAt(topicId))?.getTime()).toBe(stamp!.getTime());
  });

  it("an older send finishing late never moves it backwards", async () => {
    await loginAs(t.member.id);
    const future = new Date(Date.now() + 60_000);
    await setLastAt(topicId, future);
    await send(topicId, "متأخرة");
    expect((await lastAt(topicId))?.getTime()).toBe(future.getTime());
  });
});

describe("C1.1: deleting the newest message recomputes it in the same transaction", () => {
  it("deleting the newest falls back to the one before; deleting an older one changes nothing", async () => {
    const old = await plant(topicId, minutesAgo(30));
    const mid = await plant(topicId, minutesAgo(20));
    const newest = await plant(topicId, minutesAgo(10));
    await setLastAt(topicId, newest.createdAt);
    await loginAs(t.member.id);

    await remove(old.id);
    expect((await lastAt(topicId))?.getTime()).toBe(newest.createdAt.getTime());

    await remove(newest.id);
    expect((await lastAt(topicId))?.getTime()).toBe(mid.createdAt.getTime());
  });

  it("a deleted message earlier in the thread is skipped when falling back", async () => {
    const gone = await plant(topicId, minutesAgo(30), { deletedAt: minutesAgo(25) });
    const keep = await plant(topicId, minutesAgo(20));
    const newest = await plant(topicId, minutesAgo(10));
    await setLastAt(topicId, newest.createdAt);
    await loginAs(t.member.id);
    await remove(newest.id);
    expect((await lastAt(topicId))?.getTime()).toBe(keep.createdAt.getTime());
    await remove(keep.id);
    expect(gone.id).toBeTruthy();
    expect(await lastAt(topicId)).toBeNull();
  });

  it("deleting does not reorder the list: updatedAt stays as it was", async () => {
    await plant(topicId, minutesAgo(20));
    const newest = await plant(topicId, minutesAgo(10));
    await setLastAt(topicId, newest.createdAt);
    const before = (await db.conversation.findUniqueOrThrow({ where: { id: topicId } })).updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await loginAs(t.member.id);
    await remove(newest.id);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: topicId } })).updatedAt.getTime()).toBe(before.getTime());
  });

  it("a moderator deleting somebody else's newest message recomputes too", async () => {
    const before = await plant(topicId, minutesAgo(20));
    const newest = await plant(topicId, minutesAgo(10));
    await setLastAt(topicId, newest.createdAt);
    await loginAs(t.owner.id);
    await remove(newest.id);
    expect((await lastAt(topicId))?.getTime()).toBe(before.createdAt.getTime());
  });

  it("a system line counts as a message when falling back (the backfill counts it as well)", async () => {
    const sys = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topicId, authorId: t.member.id, body: "{}", kind: "SYSTEM", createdAt: minutesAgo(20) } });
    const newest = await plant(topicId, minutesAgo(10));
    await setLastAt(topicId, newest.createdAt);
    await loginAs(t.member.id);
    await remove(newest.id);
    expect((await lastAt(topicId))?.getTime()).toBe(sys.createdAt.getTime());
  });
});

describe("C1.1: the data move (its own migration) fills what is empty, ignores deleted messages, repeats safely", () => {
  const backfillSql = () => readFileSync(path.join(MIGRATIONS, BACKFILL, "migration.sql"), "utf8");

  it("fills from the newest non-deleted message, leaves empty conversations NULL, never overwrites, and a second run changes nothing", async () => {
    const ws2 = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const quiet = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws2.id, title: "هادئ" } });
    const onlyDeleted = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws2.id, title: "محذوف" } });
    const already = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws2.id, title: "مضبوط" } });

    await plant(topicId, minutesAgo(50));
    const newestLive = await plant(topicId, minutesAgo(40));
    await plant(topicId, minutesAgo(5), { deletedAt: minutesAgo(1) });
    await plant(onlyDeleted.id, minutesAgo(30), { deletedAt: minutesAgo(2) });
    await plant(already.id, minutesAgo(15));
    const keep = minutesAgo(1);
    await setLastAt(already.id, keep);
    await setLastAt(topicId, null);
    await setLastAt(dmId, null);

    await db.$executeRawUnsafe(backfillSql());
    expect((await lastAt(topicId))?.getTime()).toBe(newestLive.createdAt.getTime());
    expect(await lastAt(quiet.id)).toBeNull();
    expect(await lastAt(onlyDeleted.id)).toBeNull();
    expect((await lastAt(already.id))?.getTime()).toBe(keep.getTime());
    expect(await lastAt(dmId)).toBeNull();

    const snapshot = async () =>
      JSON.stringify(await db.$queryRaw`SELECT "id", "lastMessageAt", "updatedAt" FROM "Conversation" WHERE "orgId" = ${t.org.id} ORDER BY "id"`);
    const first = await snapshot();
    await db.$executeRawUnsafe(backfillSql());
    expect(await snapshot()).toBe(first);
  });

  it("the data move has a WHERE and no schema change", () => {
    const sql = backfillSql();
    expect(sql).toMatch(/\bWHERE\b/i);
    expect(sql).toMatch(/"deletedAt"\s+IS\s+NULL/i);
    expect(sql).toMatch(/"lastMessageAt"\s+IS\s+NULL/i);
  });
});

describe("C1.8: the writers C1.1 left behind move the column too (forward, system lines)", () => {
  it("forwarding a message moves the TARGET conversation's lastMessageAt to the copy's time, and not the source's", async () => {
    await loginAs(t.member.id);
    const original = await send(topicId, "للتحويل");
    const sourceStamp = await lastAt(topicId);
    await new Promise((r) => setTimeout(r, 5));
    const res = await call(forwardRoute.POST, { method: "POST", params: { id: original.id }, body: { conversationId: dmId } });
    expect(res.status).toBe(201);
    const copy = await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } });
    expect((await lastAt(dmId))?.getTime()).toBe(copy.createdAt.getTime());
    expect((await lastAt(topicId))?.getTime()).toBe(sourceStamp!.getTime());
  });

  it("a forward finishing late never moves it backwards", async () => {
    await loginAs(t.member.id);
    const original = await send(topicId, "للتحويل المتأخر");
    const future = new Date(Date.now() + 60_000);
    await setLastAt(dmId, future);
    expect((await call(forwardRoute.POST, { method: "POST", params: { id: original.id }, body: { conversationId: dmId } })).status).toBe(201);
    expect((await lastAt(dmId))?.getTime()).toBe(future.getTime());
  });

  it("a pin writes a system line, and the line moves lastMessageAt with it (same transaction)", async () => {
    await loginAs(t.member.id);
    const m = await send(dmId, "للتثبيت");
    const before = await lastAt(dmId);
    await new Promise((r) => setTimeout(r, 5));
    expect((await call(pinRoute.POST, { method: "POST", params: { id: m.id } })).status).toBe(200);
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: dmId, kind: "SYSTEM" }, orderBy: { createdAt: "desc" } });
    expect(line.createdAt.getTime()).toBeGreaterThan(before!.getTime());
    expect((await lastAt(dmId))?.getTime()).toBe(line.createdAt.getTime());
  });

  it("a system line never moves it backwards either", async () => {
    await loginAs(t.member.id);
    const m = await send(dmId, "للتثبيت المتأخر");
    const future = new Date(Date.now() + 60_000);
    await setLastAt(dmId, future);
    expect((await call(pinRoute.POST, { method: "POST", params: { id: m.id } })).status).toBe(200);
    expect((await lastAt(dmId))?.getTime()).toBe(future.getTime());
  });
});
