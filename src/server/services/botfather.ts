import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { loadOrgFacts } from "@/server/policy/conversation";
import { isOfSpace } from "@/server/chat/space-people";
import { moveLastMessageAt, systemMessage } from "@/server/chat/system";
import { emitRealtime } from "@/server/realtime/emit";
import { log } from "@/server/log";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { createBot, deleteBot, listBots, revokeBotToken, rotateBotToken, setBotCommands, setBotDescription, setBotWebhook, type BotDto } from "@/server/services/bots";
import { BOTFATHER_EMOJI, BOTFATHER_TITLE, BOTFATHER_WORDS, botFatherChatKey, isBotFatherChatOf, parseBotCommands, parseBotFatherCall, parseNewBot, type BotFatherCall } from "@/lib/chat/botfather";

/**
 * «بوت فاذر» — the system chat where the owner and the admins make bots (docs/contracts/bots.md), like Telegram's.
 *
 *   WHAT   ONE conversation per person and space: a restricted topic with only that person in it, titled «بوت فاذر», found by \`dmKey = botfather|<userId>@<spaceId>\`. A message there
 *          that starts with a command is answered by a line of the conversation (a system line \`{k:"botfather", p:{text}}\`); anything else is answered with the help.
 *   WHO    the owner and the admins (never an external partner), while the switch \`botFather\` is on.
 *   SECRET what must be shown once — a new token, a webhook's secret — is NEVER written into the conversation: the line says it is waiting and carries \`reveal: 1\`; the screen asks
 *          \`GET /api/chat/botfather/reveal/<lineId>\` once and the server forgets it (kept in memory for 15 minutes only; after a restart the answer is «ask again», and «/token» makes a new one).
 */

const REVEAL_TTL_MS = 15 * 60_000;
export interface Reveal {
  token?: string;
  webhookSecret?: string;
  username?: string;
}
const reveals = new Map<string, { userId: string; conversationId: string; at: number; reveal: Reveal }>();

function stash(messageId: string, userId: string, conversationId: string, reveal: Reveal): void {
  const now = Date.now();
  for (const [key, held] of reveals) if (now - held.at > REVEAL_TTL_MS) reveals.delete(key);
  if (reveals.size > 500) reveals.clear();
  reveals.set(messageId, { userId, conversationId, at: now, reveal });
}

/** The secret of one line, once: only the person the chat belongs to gets it, and the server forgets it as it hands it over. */
export async function takeReveal(ctx: OrgAccessContext, messageId: string): Promise<Reveal> {
  const held = reveals.get(messageId);
  if (!held || held.userId !== ctx.userId || Date.now() - held.at > REVEAL_TTL_MS) throw new NotFoundError("botfather.reveal_gone");
  const conv = await db.conversation.findFirst({ where: { id: held.conversationId, orgId: ctx.orgId }, select: { dmKey: true } });
  if (!conv || !isBotFatherChatOf(conv.dmKey, ctx.userId)) throw new NotFoundError("botfather.reveal_gone");
  reveals.delete(messageId);
  return held.reveal;
}

const t = (key: string, vars: Record<string, string | number> = {}): string => interpolate(AR[key] ?? key, { ...BOTFATHER_WORDS, ...vars });

/** Opens (or finds) the person's chat with «بوت فاذر» in the space they are in. */
export async function openBotFatherChat(ctx: OrgAccessContext, spaceId: string | null): Promise<{ id: string; created: boolean }> {
  const me = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!me || me.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  if (me.role === "GUEST" || (me.role !== "OWNER" && me.role !== "ADMIN")) throw new ForbiddenError("bots.not_allowed");
  await assertFeatureOn(ctx.orgId, "botFather");
  if (!spaceId || !(await isOfSpace(ctx.orgId, spaceId, ctx.userId))) throw new NotFoundError("chat.e.not_found");

  const dmKey = botFatherChatKey(ctx.userId, spaceId);
  const find = () => db.conversation.findFirst({ where: { orgId: ctx.orgId, dmKey }, select: { id: true } });
  const found = await find();
  if (found) {
    await db.conversationMember.createMany({ data: [{ conversationId: found.id, userId: ctx.userId }], skipDuplicates: true });
    return { id: found.id, created: false };
  }
  try {
    const created = await db.conversation.create({
      data: { orgId: ctx.orgId, kind: "TOPIC", title: BOTFATHER_TITLE, emoji: BOTFATHER_EMOJI, spaceId, topicType: "DISCUSSION", restricted: true, dmKey, members: { create: [{ userId: ctx.userId }] } },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
      const again = await find();
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
}

/** Is the row «بوت فاذر» to be drawn for this person: the switch is on and they may make bots. */
export async function botFatherOffered(orgId: string, role: string): Promise<boolean> {
  return (role === "OWNER" || role === "ADMIN") && (await isFeatureOn(orgId, "botFather"));
}

const botLine = (b: BotDto): string => t("botfather.row", { name: b.name, username: b.username, token: b.tokenHint ?? t("botfather.no_token"), hook: b.webhookHost ?? t("botfather.no_hook"), commands: b.commands.length });

/** What a failure of the services says, as a sentence of the dictionary (never a stack, never what was typed). */
function failureText(err: unknown): string {
  if (err instanceof ForbiddenError) return t("botfather.err_not_allowed");
  if (err instanceof NotFoundError) return t(err.message === "features.off" ? "botfather.err_switch" : err.message === "bots.space_not_found" ? "botfather.err_space" : "botfather.err_not_found");
  if (err instanceof ValidationError) {
    const first = err.issues?.[0]?.message ?? "";
    const known: Record<string, string> = {
      "bots.username_invalid": "botfather.err_username",
      "bots.username_taken": "botfather.err_taken",
      "bots.name_invalid": "botfather.err_name",
      "bots.webhook_invalid": "botfather.err_webhook",
      "bots.description_too_long": "botfather.err_description",
    };
    return t(known[first] ?? "botfather.err_failed");
  }
  return t("botfather.err_failed");
}

interface Answer {
  text: string;
  reveal?: Reveal;
}

/** Runs ONE command of the person and answers it in words. Never throws: a failure is the answer. */
export async function runBotFatherCall(ctx: OrgAccessContext, call: BotFatherCall, spaceId: string | null): Promise<Answer> {
  try {
    switch (call.command) {
      case "newbot": {
        const parsed = parseNewBot(call.args);
        if (!parsed) return { text: t("botfather.usage_newbot") };
        if (!spaceId) return { text: t("botfather.err_space") };
        const made = await createBot(ctx, { name: parsed.name, username: parsed.username, workspaceId: spaceId });
        const doorsOn = (await isFeatureOn(ctx.orgId, "apiDoor")) && (await isFeatureOn(ctx.orgId, "doorMessages"));
        return { text: t("botfather.created", { name: made.bot.name, username: made.bot.username }) + (doorsOn ? "" : `\n${t("botfather.doors_off")}`), reveal: { token: made.token, webhookSecret: made.webhookSecret, username: made.bot.username } };
      }
      case "mybots": {
        const bots = await listBots(ctx);
        return { text: bots.length === 0 ? t("botfather.list_empty") : `${t("botfather.list_title", { n: bots.length })}\n${bots.map(botLine).join("\n")}` };
      }
      case "token": {
        if (!call.handle) return { text: t("botfather.usage_token") };
        const out = await rotateBotToken(ctx, call.handle);
        return { text: t("botfather.token_made", { name: out.bot.name, username: out.bot.username }), reveal: { token: out.token, username: out.bot.username } };
      }
      case "revoke": {
        if (!call.handle) return { text: t("botfather.usage_revoke") };
        const out = await revokeBotToken(ctx, call.handle);
        return { text: t(out.revoked > 0 ? "botfather.revoked" : "botfather.revoked_none", { username: out.bot.username }) };
      }
      case "setdescription": {
        if (!call.handle) return { text: t("botfather.usage_setdescription") };
        const bot = await setBotDescription(ctx, call.handle, call.rest);
        return { text: t(bot.description ? "botfather.description_set" : "botfather.description_cleared", { username: bot.username }) };
      }
      case "setcommands": {
        if (!call.handle) return { text: t("botfather.usage_setcommands") };
        const parsed = parseBotCommands(call.rest);
        if (!parsed.ok) return { text: t("botfather.err_commands", { line: parsed.line }) };
        const bot = await setBotCommands(ctx, call.handle, parsed.commands);
        return { text: t("botfather.commands_set", { username: bot.username, n: bot.commands.length }) };
      }
      case "setwebhook": {
        if (!call.handle) return { text: t("botfather.usage_setwebhook") };
        const out = await setBotWebhook(ctx, call.handle, call.rest);
        return out.webhookSecret
          ? { text: t("botfather.webhook_set", { username: out.bot.username, host: out.bot.webhookHost ?? "" }), reveal: { webhookSecret: out.webhookSecret, username: out.bot.username } }
          : { text: t("botfather.webhook_cleared", { username: out.bot.username }) };
      }
      case "setavatar":
        return { text: t("botfather.avatar_later") };
      case "deletebot": {
        if (!call.handle) return { text: t("botfather.usage_deletebot") };
        // a delete is not one slip of the finger: the handle must be repeated with «confirm»
        if (call.rest.trim().toLowerCase() !== "confirm") return { text: t("botfather.confirm_delete", { username: call.handle }) };
        await deleteBot(ctx, call.handle);
        return { text: t("botfather.deleted", { username: call.handle }) };
      }
      default:
        return { text: t("botfather.help") };
    }
  } catch (err) {
    if (!(err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof ValidationError)) log.error("botfather.command_failed", { name: err instanceof Error ? err.name : "unknown" });
    return { text: failureText(err) };
  }
}

const jobs = new Set<Promise<unknown>>();

/** After a text message was stored: if it was written in the sender's own chat with «بوت فاذر», answer it (never delays the send). */
export function afterBotFatherMessage(input: { orgId: string; conversationId: string; messageId: string; authorId: string; body: string }): void {
  const job = answer(input).catch((err: unknown) => log.error("botfather.crashed", { name: err instanceof Error ? err.name : "unknown" }));
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

async function answer(input: { orgId: string; conversationId: string; messageId: string; authorId: string; body: string }): Promise<void> {
  const conv = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { dmKey: true, spaceId: true } });
  // only the person the chat belongs to wakes it
  if (!conv || !isBotFatherChatOf(conv.dmKey, input.authorId)) return;
  const me = await loadOrgFacts(input.authorId, input.orgId);
  const ctx: OrgAccessContext = { orgId: input.orgId, userId: input.authorId, orgRole: (me?.role ?? "GUEST") as OrgAccessContext["orgRole"] };
  const out = await runBotFatherCall(ctx, parseBotFatherCall(input.body), conv.spaceId);
  const reveal = out.reveal;
  const id = await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({
      data: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        authorId: input.authorId,
        body: systemMessage("botfather", { text: out.text, ...(reveal ? { reveal: 1 } : {}) }),
        kind: "SYSTEM",
        clientId: `botfather:${input.messageId}`,
      },
      select: { id: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
    await moveLastMessageAt(tx, input.conversationId, msg.createdAt);
    await emitRealtime(tx, input.orgId, "message.created", { conversationId: input.conversationId, messageId: msg.id, ...(conv.spaceId ? { spaceId: conv.spaceId } : {}) });
    return msg.id;
  });
  if (reveal) stash(id, input.authorId, input.conversationId, reveal);
}

/** Tests: wait until every message to «بوت فاذر» has been answered. */
export async function settleBotFatherForTests(): Promise<void> {
  while (jobs.size > 0) await Promise.all([...jobs]);
}
