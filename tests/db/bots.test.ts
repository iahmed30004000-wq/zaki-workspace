import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/v2/messages/route";
import { withFeature } from "@/lib/features";
import { failureLimiter, messageLimiter } from "@/server/door/limits";
import { createBot, deleteBot, judgeWebhookUrl, listBots, revokeBotToken, rotateBotToken, setBotCommands, setBotDescription, setBotWebhook, webhookSecretOf } from "@/server/services/bots";
import { call, db, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * «بوت فاذر» — the bots of a company: who makes one, what a bot is (an account that never signs in), its token (the door of messages, posting AS the bot), the webhook, and the
 * ends (revoke, delete). Real PostgreSQL, the real door route.
 */
beforeEach(() => {
  failureLimiter.reset("unknown");
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

async function world(opts: { botFather?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.owner.id, role: "ADMIN" }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "Space A");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "تقارير", doorKey: "reports" } });
  await setFeatures(team.org.id, { apiDoor: true, doorMessages: true, botFather: opts.botFather !== false });
  const ctx = (u: { id: string }, role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST" = "ADMIN") => ({ orgId: team.org.id, userId: u.id, orgRole: role });
  return { ...team, space, topic, ctx };
}
const handle = () => `b${uid().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}_bot`;
const door = (token: string) =>
  call(messagesRoute.POST, {
    url: "http://localhost/api/v2/messages",
    body: { topicKey: "reports", card: { title: "من البوت", lines: [{ label: "الحالة", value: "تمام" }], status: "ok" } },
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `key-${uid()}-abcdefgh` },
  });

describe("who makes a bot", () => {
  it("the owner and an admin do; a member and a guest are refused (403) and nothing is made", async () => {
    const w = await world();
    for (const [user, role] of [[w.owner, "OWNER"], [w.admin, "ADMIN"]] as const) {
      const made = await createBot(w.ctx(user, role), { name: "بوت الطلبات", username: handle(), workspaceId: w.space.id });
      expect(made.token).toMatch(/^zws_[0-9a-f]{12}\./);
    }
    const before = await db.bot.count({ where: { orgId: w.org.id } });
    for (const [user, role] of [[w.member, "MEMBER"], [w.guest, "GUEST"]] as const) {
      await expect(createBot(w.ctx(user, role), { name: "x", username: handle(), workspaceId: w.space.id })).rejects.toMatchObject({ message: "bots.not_allowed" });
    }
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(before);
  });

  it("with the switch off nothing is made (404), but the list still opens", async () => {
    const w = await world({ botFather: false });
    await expect(createBot(w.ctx(w.admin), { name: "x", username: handle(), workspaceId: w.space.id })).rejects.toMatchObject({ message: "features.off" });
    expect(await db.bot.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await listBots(w.ctx(w.admin))).toEqual([]);
  });

  it("the space must be one the maker is in (404), the handle must be a bot's (422) and free (422), the name 1 to 40 characters (422)", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Not mine");
    await expect(createBot(w.ctx(w.admin), { name: "x", username: handle(), workspaceId: other.id })).rejects.toBeTruthy();
    await expect(createBot(w.ctx(w.admin), { name: "x", username: "orders", workspaceId: w.space.id })).rejects.toMatchObject({ issues: [{ message: "bots.username_invalid" }] });
    await expect(createBot(w.ctx(w.admin), { name: "   ", username: handle(), workspaceId: w.space.id })).rejects.toMatchObject({ issues: [{ message: "bots.name_invalid" }] });
    const h = handle();
    await createBot(w.ctx(w.admin), { name: "أول", username: h, workspaceId: w.space.id });
    await expect(createBot(w.ctx(w.owner, "OWNER"), { name: "تاني", username: h.toUpperCase(), workspaceId: w.space.id })).rejects.toMatchObject({ issues: [{ message: "bots.username_taken" }] });
  });
});

describe("what a bot is", () => {
  it("an ordinary member (MEMBER, active) with its own account, in the space, whose password nobody knows; its webhook secret and token are shown once and kept encrypted / hashed", async () => {
    const w = await world();
    const h = handle();
    const made = await createBot(w.ctx(w.admin), { name: "بوت الطلبات", username: h, workspaceId: w.space.id });
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    const user = await db.user.findUniqueOrThrow({ where: { id: bot.userId }, include: { memberships: true, workspaceLinks: true } });
    expect(user).toMatchObject({ username: h, name: "بوت الطلبات", email: null });
    expect(user.memberships).toMatchObject([{ organizationId: w.org.id, role: "MEMBER", status: "ACTIVE" }]);
    expect(user.workspaceLinks.map((l) => l.workspaceId)).toEqual([w.space.id]);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    // nothing readable is stored: the token only as a hash, the webhook secret only as a cipher
    const token = await db.apiToken.findFirstOrThrow({ where: { createdById: user.id } });
    expect(token.tokenHash).not.toContain(made.token);
    expect(JSON.stringify(token)).not.toContain(made.token.split(".")[1]!);
    expect(bot.webhookSecretCipher).not.toContain(made.webhookSecret);
    expect(webhookSecretOf(bot.webhookSecretCipher)).toBe(made.webhookSecret);
    expect(token).toMatchObject({ system: "bot", permissions: ["messages.write"], workspaceId: w.space.id });
    expect(JSON.stringify(made.bot)).not.toContain(made.token);
    expect(made.bot.tokenHint).toBe(`zws_${token.prefix}…`);
  });

  it("its token is the door of messages' and posts AS the bot, with the bot's name on the bubble", async () => {
    const w = await world();
    const made = await createBot(w.ctx(w.admin), { name: "بوت الطلبات", username: handle(), workspaceId: w.space.id });
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, id: made.bot.id } });
    messageLimiter.reset(`t:${bot.tokenId}`);
    const res = await door(made.token);
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    const msg = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic.id }, orderBy: { createdAt: "desc" } });
    expect(msg.authorId).toBe(bot.userId);
    expect(msg.viaApp).toBe("بوت الطلبات");
  });
});

describe("the bot's settings", () => {
  it("description, commands and webhook are kept; the webhook is shown as a host only, its secret once, and a public http or a private address is refused", async () => {
    const w = await world();
    const h = handle();
    await createBot(w.ctx(w.admin), { name: "بوت", username: h, workspaceId: w.space.id });
    expect((await setBotDescription(w.ctx(w.admin), `@${h}`, "بيعمل كذا")).description).toBe("بيعمل كذا");
    expect((await db.user.findFirstOrThrow({ where: { username: h } })).bio).toBe("بيعمل كذا");
    expect((await setBotCommands(w.ctx(w.admin), h, [{ command: "start", description: "ابدأ" }])).commands).toEqual([{ command: "start", description: "ابدأ" }]);
    const hook = await setBotWebhook(w.ctx(w.admin), h, "http://n8n:5678/webhook/secret-path?k=1");
    expect(hook.bot.webhookHost).toBe("n8n:5678");
    expect(JSON.stringify(hook.bot)).not.toContain("secret-path");
    expect(hook.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    await expect(setBotWebhook(w.ctx(w.admin), h, "http://example.com/hook")).rejects.toMatchObject({ issues: [{ message: "bots.webhook_invalid" }] });
    await expect(setBotWebhook(w.ctx(w.admin), h, "https://user:pw@example.com/hook")).rejects.toBeTruthy();
    expect((await setBotWebhook(w.ctx(w.admin), h, "")).bot.webhookHost).toBeNull();
    await expect(setBotDescription(w.ctx(w.admin), h, "ك".repeat(300))).rejects.toMatchObject({ issues: [{ message: "bots.description_too_long" }] });
  });

  it("the address judge: inside the server or https at a public name; never a login in it, a fragment or plain http outside", () => {
    expect(judgeWebhookUrl("http://n8n:5678/h").ok).toBe(true);
    expect(judgeWebhookUrl("https://hooks.example.com/zaki?x=1").ok).toBe(true);
    for (const bad of ["http://hooks.example.com/h", "ftp://x/y", "https://a:b@hooks.example.com/", "https://hooks.example.com/#frag", "not a url", "https://localhost.evil.test@internal/"]) expect(judgeWebhookUrl(bad).ok, bad).toBe(false);
  });
});

describe("the ends", () => {
  it("a new token kills the old one (401) and works; «/revoke» kills it for good and works while the switch is off", async () => {
    const w = await world();
    const h = handle();
    const first = await createBot(w.ctx(w.admin), { name: "بوت", username: h, workspaceId: w.space.id });
    const second = await rotateBotToken(w.ctx(w.admin), h);
    expect(second.token).not.toBe(first.token);
    expect((await door(first.token)).status).toBe(401);
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    messageLimiter.reset(`t:${bot.tokenId}`);
    expect((await door(second.token)).status).toBeLessThan(300);
    await setFeatures(w.org.id, { botFather: false });
    const revoked = await revokeBotToken(w.ctx(w.admin), h);
    expect(revoked.revoked).toBe(1);
    expect(revoked.bot.tokenHint).toBeNull();
    expect((await door(second.token)).status).toBe(401);
    await expect(rotateBotToken(w.ctx(w.admin), h)).rejects.toBeTruthy();
  });

  it("deleting frees the handle, ends the token, suspends the account and keeps what the bot said", async () => {
    const w = await world();
    const h = handle();
    const made = await createBot(w.ctx(w.admin), { name: "بوت", username: h, workspaceId: w.space.id });
    const bot = await db.bot.findFirstOrThrow({ where: { orgId: w.org.id, username: h } });
    messageLimiter.reset(`t:${bot.tokenId}`);
    await door(made.token);
    await deleteBot(w.ctx(w.admin), h);
    expect((await door(made.token)).status).toBe(401);
    expect(await db.organizationMember.findFirstOrThrow({ where: { userId: bot.userId } })).toMatchObject({ status: "OFFBOARDED" });
    expect((await listBots(w.ctx(w.admin))).map((b) => b.username)).not.toContain(h);
    expect(await db.chatMessage.count({ where: { authorId: bot.userId } })).toBeGreaterThan(0);
    // the handle is free again
    await expect(createBot(w.ctx(w.admin), { name: "جديد", username: h, workspaceId: w.space.id })).resolves.toBeTruthy();
  });

  it("a bot of another company is not found (the same «not found»)", async () => {
    const a = await world();
    const b = await world();
    const h = handle();
    await createBot(a.ctx(a.admin), { name: "بوت", username: h, workspaceId: a.space.id });
    await expect(rotateBotToken(b.ctx(b.admin), h)).rejects.toMatchObject({ message: "bots.not_found" });
    await expect(deleteBot(b.ctx(b.admin), h)).rejects.toMatchObject({ message: "bots.not_found" });
  });
});
