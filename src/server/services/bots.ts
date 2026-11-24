import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { decryptSecrets, encryptSecrets, generateSharedSecret } from "@/server/crypto";
import { generateToken } from "@/server/door/tokens";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { assertFeatureOn } from "@/server/services/features";
import { setAvatar } from "@/server/services/avatars";
import { isOfSpace } from "@/server/chat/space-people";
import { BOT_DESCRIPTION_MAX, BOT_NAME_MAX, isBotUsername, normalizeBotUsername, type BotCommandDef } from "@/lib/chat/botfather";

/**
 * «بوت فاذر» — the bots of a company (docs/contracts/bots.md).
 *
 *   WHO     the owner and the admins (never an external partner), while the switch `botFather` is on (the doors that only SHOW or END a bot — the list, revoking a token,
 *           deleting — work while it is off too: the owner must be able to kill a bot).
 *   WHAT    a bot is an ordinary member of the company (rank MEMBER, no password anyone knows, it never signs in) with its own account, so what it posts is its own and the
 *           space and topic lists hold it like anybody. It is added to ONE space (the one its maker was in) and to the topics people add it to.
 *   TOKEN   the token is the door of messages' (`messages.write`; `zws_…`, shown ONCE, only its hash is kept) and its issuer is the bot's account: `POST /api/v2/messages` posts as the
 *           bot, in a topic it may post in, with the bot's name on the bubble. It needs the owner's switches «باب الربط» and «باب الرسائل» like every token.
 *   HOOK    `webhookUrl` (an address inside the server or an https address of a public name; judged again on every call) gets the messages that address the bot, signed with
 *           the bot's own secret (`webhookSecretCipher`, encrypted; shown once when it is made or changed).
 */

export interface BotDto {
  id: string;
  username: string;
  name: string;
  description: string | null;
  commands: BotCommandDef[];
  /** the host of the webhook (never the path or the query: they may carry a secret) */
  webhookHost: string | null;
  workspaceId: string;
  /** the public part of the live token, `zws_ab12…`, or null when it was revoked */
  tokenHint: string | null;
  createdAt: Date;
}

const BOT_SELECT = { id: true, username: true, name: true, description: true, commands: true, webhookUrl: true, workspaceId: true, tokenId: true, createdAt: true } satisfies Prisma.BotSelect;

function commandsOf(value: unknown): BotCommandDef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const { command, description } = c as { command?: unknown; description?: unknown };
    return typeof command === "string" && typeof description === "string" ? [{ command, description }] : [];
  });
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function toDto(row: Prisma.BotGetPayload<{ select: typeof BOT_SELECT }>): Promise<BotDto> {
  const token = row.tokenId ? await db.apiToken.findUnique({ where: { id: row.tokenId }, select: { prefix: true, revokedAt: true } }) : null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description,
    commands: commandsOf(row.commands),
    webhookHost: hostOf(row.webhookUrl),
    workspaceId: row.workspaceId,
    tokenHint: token && !token.revokedAt ? `zws_${token.prefix}…` : null,
    createdAt: row.createdAt,
  };
}

/** The owner and the admins, active in the company, and never an external partner. */
async function assertMaker(ctx: OrgAccessContext): Promise<void> {
  if (ctx.orgRole !== "OWNER" && ctx.orgRole !== "ADMIN") throw new ForbiddenError("bots.not_allowed");
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } }, select: { status: true, role: true } });
  if (!member || member.status !== "ACTIVE" || member.role === "GUEST") throw new ForbiddenError("bots.not_allowed");
}

async function botOf(ctx: OrgAccessContext, handle: string) {
  const username = normalizeBotUsername(handle);
  const bot = await db.bot.findFirst({ where: { orgId: ctx.orgId, username, deletedAt: null }, select: { ...BOT_SELECT, userId: true, webhookSecretCipher: true } });
  if (!bot) throw new NotFoundError("bots.not_found");
  return bot;
}

/** A fresh token for the bot: its issuer is the bot's own account, so the door posts AS the bot. The whole token is returned ONCE. */
async function mintToken(tx: Prisma.TransactionClient, bot: { id: string; orgId: string; userId: string; workspaceId: string; name: string }, byUserId: string): Promise<string> {
  const fresh = generateToken();
  const made = await tx.apiToken.create({
    data: { organizationId: bot.orgId, name: bot.name, prefix: fresh.prefix, tokenHash: fresh.hash, permissions: ["messages.write"], system: "bot", workspaceId: bot.workspaceId, createdById: bot.userId },
    select: { id: true },
  });
  await tx.bot.update({ where: { id: bot.id }, data: { tokenId: made.id } });
  await tx.auditLog.create({ data: { action: "bot.token_made", actorId: byUserId, orgId: bot.orgId, target: bot.id, workspaceId: bot.workspaceId, meta: { tokenId: made.id } } });
  return fresh.token;
}

async function revokeLive(tx: Prisma.TransactionClient, botUserId: string, byUserId: string, orgId: string, botId: string): Promise<number> {
  const live = await tx.apiToken.findMany({ where: { organizationId: orgId, createdById: botUserId, revokedAt: null }, select: { id: true } });
  if (live.length === 0) return 0;
  await tx.apiToken.updateMany({ where: { id: { in: live.map((t) => t.id) }, revokedAt: null }, data: { revokedAt: new Date(), revokedById: byUserId, revokedReason: "manual" } });
  await tx.auditLog.create({ data: { action: "bot.token_revoked", actorId: byUserId, orgId, target: botId, meta: { count: live.length } } });
  return live.length;
}

export interface NewBotInput {
  name: string;
  username: string;
  /** the space the bot belongs to: one the maker is in */
  workspaceId: string;
}

/** «/newbot»: the bot, its account, its place in the space, its first token and its webhook secret (both returned once). */
export async function createBot(ctx: OrgAccessContext, input: NewBotInput): Promise<{ bot: BotDto; token: string; webhookSecret: string }> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const name = input.name.trim().replace(/\s+/g, " ");
  const username = normalizeBotUsername(input.username);
  if (name.length === 0 || [...name].length > BOT_NAME_MAX) throw new ValidationError([{ path: "name", message: "bots.name_invalid" }]);
  if (!isBotUsername(username)) throw new ValidationError([{ path: "username", message: "bots.username_invalid" }]);
  if (!(await isOfSpace(ctx.orgId, input.workspaceId, ctx.userId))) throw new NotFoundError("bots.space_not_found");
  // one handle in the whole installation (an account's username is unique), and one per company among bots
  if ((await db.user.findUnique({ where: { username }, select: { id: true } })) || (await db.bot.findFirst({ where: { orgId: ctx.orgId, username }, select: { id: true } }))) throw new ValidationError([{ path: "username", message: "bots.username_taken" }]);

  // an account nobody can sign in to: a bcrypt hash of a secret that is thrown away
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const secret = generateSharedSecret();
  try {
    const out = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          name,
          passwordHash,
          transparencyVersion: 1,
          transparencyAcceptedAt: new Date(),
          memberships: { create: { organizationId: ctx.orgId, role: "MEMBER" } },
          workspaceLinks: { create: { workspaceId: input.workspaceId, role: "MEMBER" } },
        },
        select: { id: true },
      });
      const bot = await tx.bot.create({
        data: { orgId: ctx.orgId, userId: user.id, ownerId: ctx.userId, workspaceId: input.workspaceId, username, name, webhookSecretCipher: encryptSecrets({ secret }) },
        select: { ...BOT_SELECT, userId: true },
      });
      const token = await mintToken(tx, { id: bot.id, orgId: ctx.orgId, userId: user.id, workspaceId: input.workspaceId, name }, ctx.userId);
      await tx.auditLog.create({ data: { action: "bot.created", actorId: ctx.userId, orgId: ctx.orgId, target: bot.id, workspaceId: input.workspaceId, meta: { username } } });
      return { botId: bot.id, token };
    });
    const fresh = await db.bot.findUniqueOrThrow({ where: { id: out.botId }, select: BOT_SELECT });
    return { bot: await toDto(fresh), token: out.token, webhookSecret: secret };
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") throw new ValidationError([{ path: "username", message: "bots.username_taken" }]);
    throw err;
  }
}

/** «/mybots»: every bot of the company (the owner and the admins see them all). Works while the switch is off. */
export async function listBots(ctx: OrgAccessContext): Promise<BotDto[]> {
  await assertMaker(ctx);
  const rows = await db.bot.findMany({ where: { orgId: ctx.orgId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: BOT_SELECT });
  return Promise.all(rows.map(toDto));
}

/** «/token»: the old token is revoked and a new one is made; the whole new token is returned once. */
export async function rotateBotToken(ctx: OrgAccessContext, handle: string): Promise<{ bot: BotDto; token: string }> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  const token = await db.$transaction(async (tx) => {
    await revokeLive(tx, bot.userId, ctx.userId, ctx.orgId, bot.id);
    return mintToken(tx, { id: bot.id, orgId: ctx.orgId, userId: bot.userId, workspaceId: bot.workspaceId, name: bot.name }, ctx.userId);
  });
  return { bot: await toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT })), token };
}

/** «/revoke»: kills the bot's token for good (the bot keeps its account; «/token» makes a new one). Works while the switch is off. */
export async function revokeBotToken(ctx: OrgAccessContext, handle: string): Promise<{ bot: BotDto; revoked: number }> {
  await assertMaker(ctx);
  const bot = await botOf(ctx, handle);
  const revoked = await db.$transaction((tx) => revokeLive(tx, bot.userId, ctx.userId, ctx.orgId, bot.id));
  return { bot: await toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT })), revoked };
}

export async function setBotDescription(ctx: OrgAccessContext, handle: string, description: string): Promise<BotDto> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  const text = description.trim();
  if ([...text].length > BOT_DESCRIPTION_MAX) throw new ValidationError([{ path: "description", message: "bots.description_too_long" }]);
  await db.$transaction([
    db.bot.update({ where: { id: bot.id }, data: { description: text === "" ? null : text } }),
    db.user.update({ where: { id: bot.userId }, data: { bio: text === "" ? null : text } }),
  ]);
  return toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT }));
}

/** The bot of this handle, for its maker (a miss is «not found»): what «/setavatar» checks before it starts waiting for a picture. */
export async function findBot(ctx: OrgAccessContext, handle: string): Promise<BotDto> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  return toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT }));
}

/** The bot's face: the same picture rules as a person's (still image, 2 MB, the bytes decide), stored as the BOT's own picture so every list that draws a member draws it. */
export async function setBotAvatar(ctx: OrgAccessContext, handle: string, input: { name: string; bytes: Uint8Array }): Promise<BotDto> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  await setAvatar({ orgId: ctx.orgId, orgRole: "MEMBER", userId: bot.userId }, input);
  return toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT }));
}

export async function setBotCommands(ctx: OrgAccessContext, handle: string, commands: BotCommandDef[]): Promise<BotDto> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  await db.bot.update({ where: { id: bot.id }, data: { commands: commands as unknown as Prisma.InputJsonValue } });
  return toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT }));
}

/** The address of a webhook, judged: inside the server, or https at a public name (both only by `parseLocalBaseUrl`'s own rules). Anything else is refused. */
export function judgeWebhookUrl(raw: string): { ok: true; url: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "" || url.hash !== "") return { ok: false };
  if (url.href.length > 300) return { ok: false };
  const internal = parseLocalBaseUrl(url.origin);
  if (internal.ok) return { ok: true, url: url.href };
  if (url.protocol === "https:" && parseLocalBaseUrl(url.origin, { external: true }).ok) return { ok: true, url: url.href };
  return { ok: false };
}

/** «/setwebhook»: the address the messages that address the bot are sent to (empty: none). A new secret is made and returned once. */
export async function setBotWebhook(ctx: OrgAccessContext, handle: string, address: string): Promise<{ bot: BotDto; webhookSecret: string | null }> {
  await assertMaker(ctx);
  await assertFeatureOn(ctx.orgId, "botFather");
  const bot = await botOf(ctx, handle);
  const text = address.trim();
  if (text === "") {
    await db.bot.update({ where: { id: bot.id }, data: { webhookUrl: null } });
    return { bot: await toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT })), webhookSecret: null };
  }
  const judged = judgeWebhookUrl(text);
  if (!judged.ok) throw new ValidationError([{ path: "webhookUrl", message: "bots.webhook_invalid" }]);
  const secret = generateSharedSecret();
  await db.bot.update({ where: { id: bot.id }, data: { webhookUrl: judged.url, webhookSecretCipher: encryptSecrets({ secret }) } });
  await db.auditLog.create({ data: { action: "bot.webhook_set", actorId: ctx.userId, orgId: ctx.orgId, target: bot.id, meta: { host: hostOf(judged.url) } } });
  return { bot: await toDto(await db.bot.findUniqueOrThrow({ where: { id: bot.id }, select: BOT_SELECT })), webhookSecret: secret };
}

/** «/deletebot»: the token dies, the account is suspended (its messages stay, with its name), the handle is freed. Works while the switch is off. */
export async function deleteBot(ctx: OrgAccessContext, handle: string): Promise<void> {
  await assertMaker(ctx);
  const bot = await botOf(ctx, handle);
  await db.$transaction(async (tx) => {
    await revokeLive(tx, bot.userId, ctx.userId, ctx.orgId, bot.id);
    await tx.organizationMember.updateMany({ where: { organizationId: ctx.orgId, userId: bot.userId }, data: { status: "OFFBOARDED", statusChangedAt: new Date(), statusChangedById: ctx.userId } });
    await tx.bot.update({ where: { id: bot.id }, data: { deletedAt: new Date(), webhookUrl: null, webhookSecretCipher: null, username: `${bot.username}~${bot.id.slice(-6)}` } });
    // the account's own handle is freed too: the account is no longer reachable by it
    await tx.user.update({ where: { id: bot.userId }, data: { username: `deleted~${bot.id}` } });
    await tx.auditLog.create({ data: { action: "bot.deleted", actorId: ctx.userId, orgId: ctx.orgId, target: bot.id, meta: { username: bot.username } } });
  });
}

/** The secret a webhook is signed with (decrypted for the delivery only). */
export function webhookSecretOf(cipher: string | null): string | null {
  const plain = decryptSecrets<{ secret?: unknown }>(cipher);
  return typeof plain?.secret === "string" && plain.secret.length > 0 ? plain.secret : null;
}
