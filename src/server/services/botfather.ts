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
import { readStored } from "@/server/services/files";
import { createBot, deleteBot, findBot, listBots, setBotAbout, setBotAvatar, setBotFlag, setBotName, revokeBotToken, rotateBotToken, setBotCommands, setBotDescription, setBotWebhook, type BotDto } from "@/server/services/bots";
import { randomUUID } from "node:crypto";
import {
  BOTFATHER_EMOJI,
  BOTFATHER_TITLE,
  BOTFATHER_WORDS,
  BOT_NAME_MAX,
  botFatherChatKey,
  decodeAsk,
  decodeKeyboard,
  encodeAsk,
  encodeKeyboard,
  interruptsAsk,
  isBotFatherChatOf,
  isBotTargetCommand,
  normalizeBotUsername,
  parseBotCommands,
  parseBotFatherCall,
  parseNewBot,
  type BotAsk,
  type BotFatherCall,
  type BotKeyboard,
  type BotTargetCommand,
} from "@/lib/chat/botfather";

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
      "bots.about_too_long": "botfather.err_about",
    };
    return t(known[first] ?? "botfather.err_failed");
  }
  return t("botfather.err_failed");
}

interface Answer {
  text: string;
  reveal?: Reveal;
  /** the next message of the person answers this */
  ask?: BotAsk;
  /** the buttons under the line */
  kb?: BotKeyboard;
}

// ---------- the menus: a line of text with buttons under it ----------

const button = (key: string, d: string) => ({ t: t(key), d });
const inRows = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const backTo = (d: string): BotKeyboard => [[button("botfather.btn.back", d)]];

const botLine = (b: BotDto): string => t("botfather.row", { name: b.name, username: b.username, token: b.tokenHint ?? t("botfather.no_token"), hook: b.webhookHost ?? t("botfather.no_hook"), commands: b.commands.length });

async function listView(ctx: OrgAccessContext): Promise<Answer> {
  const bots = await listBots(ctx);
  if (bots.length === 0) return { text: t("botfather.list_empty"), kb: [[button("botfather.btn.new_bot", "new")]] };
  return {
    text: `${t("botfather.list_title", { n: bots.length })}\n${bots.map(botLine).join("\n")}`,
    kb: inRows(bots.map((b) => ({ t: `@${b.username}`, d: `bot:${b.username}` })), 2),
  };
}

const menuView = (b: BotDto): Answer => ({
  text: t("botfather.menu_title", { name: b.name, username: b.username }),
  kb: [
    [button("botfather.btn.token", `tk:${b.username}`), button("botfather.btn.edit", `edit:${b.username}`)],
    [button("botfather.btn.settings", `set:${b.username}`), button("botfather.btn.delete", `del:${b.username}`)],
    [button("botfather.btn.back", "bots")],
  ],
});

const tokenView = (b: BotDto): Answer => ({
  text: t("botfather.token_view", { username: b.username, token: b.tokenHint ?? t("botfather.no_token") }),
  kb: [[button("botfather.btn.new_token", `tkn:${b.username}`), button("botfather.btn.revoke", `rv:${b.username}`)], [button("botfather.btn.back", `bot:${b.username}`)]],
});

const editView = (b: BotDto): Answer => ({
  text: t("botfather.edit_view", { username: b.username, name: b.name, description: b.description ?? t("botfather.no_hook"), commands: b.commands.length, hook: b.webhookHost ?? t("botfather.no_hook") }),
  kb: [
    [button("botfather.btn.edit_name", `ask:setname:${b.username}`), button("botfather.btn.edit_description", `ask:setdescription:${b.username}`)],
    [button("botfather.btn.edit_about", `ask:setabouttext:${b.username}`), button("botfather.btn.edit_picture", `ask:setuserpic:${b.username}`)],
    [button("botfather.btn.edit_commands", `ask:setcommands:${b.username}`), button("botfather.btn.edit_webhook", `ask:setwebhook:${b.username}`)],
    [button("botfather.btn.back", `bot:${b.username}`)],
  ],
});

const settingsView = (b: BotDto): Answer => ({
  text: t("botfather.settings_view", { username: b.username }),
  kb: [[button("botfather.btn.join", `jg:${b.username}`), button("botfather.btn.privacy", `pm:${b.username}`)], [button("botfather.btn.back", `bot:${b.username}`)]],
});

const joinView = (b: BotDto): Answer => ({
  text: t("botfather.join_view", { username: b.username, state: t(b.joinGroups ? "botfather.state_allowed" : "botfather.state_forbidden") }),
  kb: [[b.joinGroups ? button("botfather.btn.forbid", `jgset:${b.username}:0`) : button("botfather.btn.allow", `jgset:${b.username}:1`)], [button("botfather.btn.back", `set:${b.username}`)]],
});

const privacyView = (b: BotDto): Answer => ({
  text: t("botfather.privacy_view", { username: b.username, state: t(b.privacyMode ? "botfather.state_on" : "botfather.state_off") }),
  kb: [[b.privacyMode ? button("botfather.btn.turn_off", `pmset:${b.username}:0`) : button("botfather.btn.turn_on", `pmset:${b.username}:1`)], [button("botfather.btn.back", `set:${b.username}`)]],
});

const confirmDeleteView = (username: string): Answer => ({
  text: t("botfather.confirm_delete", { username }),
  kb: [[button("botfather.btn.delete_yes", `delok:${username}`), button("botfather.btn.delete_no", `bot:${username}`)]],
});

// ---------- the commands ----------

const askNewBotName = (): Answer => ({ text: t("botfather.ask_newbot_name"), ask: { c: "newbot", s: "name" } });
const askNewBotUsername = (name: string, before?: string): Answer => ({ text: before ?? t("botfather.ask_newbot_username", { name }), ask: { c: "newbot", s: "username", n: name } });
const nameFits = (name: string): boolean => name.length > 0 && [...name].length <= BOT_NAME_MAX;

async function makeBot(ctx: OrgAccessContext, name: string, username: string, spaceId: string | null): Promise<Answer> {
  if (!spaceId) return { text: t("botfather.err_space") };
  try {
    const made = await createBot(ctx, { name, username, workspaceId: spaceId });
    const doorsOn = (await isFeatureOn(ctx.orgId, "apiDoor")) && (await isFeatureOn(ctx.orgId, "doorMessages"));
    return { text: t("botfather.created", { name: made.bot.name, username: made.bot.username }) + (doorsOn ? "" : `\n${t("botfather.doors_off")}`), reveal: { token: made.token, webhookSecret: made.webhookSecret, username: made.bot.username } };
  } catch (err) {
    // a handle that is not one, or is taken: the name is kept and the handle asked again
    if (err instanceof ValidationError && err.issues?.[0]?.path === "username") return askNewBotUsername(name, failureText(err));
    throw err;
  }
}

const VALUE_QUESTIONS = {
  setname: "botfather.ask_name",
  setdescription: "botfather.ask_description",
  setabouttext: "botfather.ask_about",
  setcommands: "botfather.ask_commands",
  setwebhook: "botfather.ask_webhook",
} as const;

/** The bot must be one of mine before anything is asked about it. */
async function askValue(ctx: OrgAccessContext, command: keyof typeof VALUE_QUESTIONS, handle: string): Promise<Answer> {
  const bot = await findBot(ctx, handle);
  return { text: t(VALUE_QUESTIONS[command], { username: bot.username }), ask: { c: command, s: "value", u: bot.username } };
}

/** A command on ONE bot. `rest` is what came after the handle (or the answer to the question): empty means «ask me»; «/empty» means «nothing». */
async function act(ctx: OrgAccessContext, command: BotTargetCommand, handle: string, rest: string): Promise<Answer> {
  const said = rest.trim();
  const value = said.toLowerCase() === "/empty" ? "" : said;
  const flagWord = said.toLowerCase();
  switch (command) {
    case "token": {
      const out = await rotateBotToken(ctx, handle);
      return { text: t("botfather.token_made", { name: out.bot.name, username: out.bot.username }), reveal: { token: out.token, username: out.bot.username } };
    }
    case "revoke": {
      const out = await revokeBotToken(ctx, handle);
      return { text: t(out.revoked > 0 ? "botfather.revoked" : "botfather.revoked_none", { username: out.bot.username }) };
    }
    case "setname": {
      if (!said) return askValue(ctx, command, handle);
      const bot = await setBotName(ctx, handle, value);
      return { text: t("botfather.name_set", { username: bot.username, name: bot.name }) };
    }
    case "setdescription": {
      if (!said) return askValue(ctx, command, handle);
      const bot = await setBotDescription(ctx, handle, value);
      return { text: t(bot.description ? "botfather.description_set" : "botfather.description_cleared", { username: bot.username }) };
    }
    case "setabouttext": {
      if (!said) return askValue(ctx, command, handle);
      const bot = await setBotAbout(ctx, handle, value);
      return { text: t(value ? "botfather.about_set" : "botfather.about_cleared", { username: bot.username }) };
    }
    case "setcommands": {
      if (!said) return askValue(ctx, command, handle);
      const parsed = parseBotCommands(value);
      if (!parsed.ok) {
        const bot = await findBot(ctx, handle);
        return { text: t("botfather.err_commands", { line: parsed.line }), ask: { c: command, s: "value", u: bot.username } };
      }
      const bot = await setBotCommands(ctx, handle, parsed.commands);
      return { text: t(bot.commands.length ? "botfather.commands_set" : "botfather.commands_cleared", { username: bot.username, n: bot.commands.length }) };
    }
    case "setwebhook": {
      if (!said) return askValue(ctx, command, handle);
      const out = await setBotWebhook(ctx, handle, value);
      return out.webhookSecret
        ? { text: t("botfather.webhook_set", { username: out.bot.username, host: out.bot.webhookHost ?? "" }), reveal: { webhookSecret: out.webhookSecret, username: out.bot.username } }
        : { text: t("botfather.webhook_cleared", { username: out.bot.username }) };
    }
    case "setuserpic":
    case "setavatar": {
      const bot = await findBot(ctx, handle);
      return { text: t("botfather.avatar_wait", { username: bot.username }), ask: { c: "setavatar", s: "value", u: bot.username } };
    }
    case "setjoingroups":
      if (flagWord === "enable" || flagWord === "disable") return joinView(await setBotFlag(ctx, handle, "joinGroups", flagWord === "enable"));
      return joinView(await findBot(ctx, handle));
    case "setprivacy":
      if (flagWord === "enable" || flagWord === "disable") return privacyView(await setBotFlag(ctx, handle, "privacyMode", flagWord === "enable"));
      return privacyView(await findBot(ctx, handle));
    case "deletebot": {
      // a delete is not one slip of the finger: «confirm», or the button of the question
      if (flagWord !== "confirm") return confirmDeleteView(normalizeBotUsername(handle));
      await deleteBot(ctx, handle);
      return { text: t("botfather.deleted", { username: normalizeBotUsername(handle) }) };
    }
  }
}

/** «Which bot?»: my bots as buttons; typing the handle answers too. */
async function whichBot(ctx: OrgAccessContext, command: BotTargetCommand): Promise<Answer> {
  const bots = await listBots(ctx);
  if (bots.length === 0) return { text: t("botfather.list_empty") };
  return { text: t("botfather.ask_bot"), kb: inRows(bots.map((b) => ({ t: `@${b.username}`, d: `pick:${command}:${b.username}` })), 2), ask: { c: command, s: "bot" } };
}

async function command(ctx: OrgAccessContext, call: BotFatherCall, spaceId: string | null): Promise<Answer> {
  const name = call.command;
  if (name === "newbot") {
    const parsed = parseNewBot(call.args);
    if (parsed) return makeBot(ctx, parsed.name, parsed.username, spaceId);
    await listBots(ctx); // only a maker is asked anything
    const only = call.args.replace(/\s+/g, " ");
    return only && nameFits(only) ? askNewBotUsername(only) : askNewBotName();
  }
  if (name === "mybots") return listView(ctx);
  if (name === "cancel") return { text: t("botfather.cancel_none") };
  if (name && isBotTargetCommand(name)) return call.handle ? act(ctx, name, call.handle, call.rest) : whichBot(ctx, name);
  return { text: t("botfather.help") };
}

/** The next message of the person, read as the answer to what was asked. A refused value is asked again. */
async function reply(ctx: OrgAccessContext, ask: BotAsk, body: string, spaceId: string | null): Promise<Answer> {
  const said = body.trim();
  if (ask.c === "newbot") {
    if (ask.s === "name") {
      const name = said.replace(/\s+/g, " ");
      return nameFits(name) ? askNewBotUsername(name) : { text: t("botfather.err_name"), ask };
    }
    return makeBot(ctx, ask.n ?? "", said, spaceId);
  }
  // while a picture is waited for, words end the wait
  if (ask.c === "setavatar" || !isBotTargetCommand(ask.c)) return { text: t("botfather.help") };
  const handle = ask.s === "bot" ? (said.split(/\s+/)[0] ?? "") : (ask.u ?? "");
  try {
    return await act(ctx, ask.c, handle, ask.s === "bot" ? "" : said);
  } catch (err) {
    if (err instanceof ValidationError || (ask.s === "bot" && err instanceof NotFoundError && err.message === "bots.not_found")) return { text: failureText(err), ask };
    throw err;
  }
}

/** A refusal is an answer in words, never a crash. */
async function inWords(run: () => Promise<Answer>): Promise<Answer> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof ValidationError)) log.error("botfather.command_failed", { name: err instanceof Error ? err.name : "unknown" });
    return { text: failureText(err) };
  }
}

/** Runs ONE command of the person and answers it in words. Never throws: a failure is the answer. */
export async function runBotFatherCall(ctx: OrgAccessContext, call: BotFatherCall, spaceId: string | null): Promise<Answer> {
  return inWords(() => command(ctx, call, spaceId));
}

// ---------- the lines ----------

/** One conversation is answered one thing at a time: two quick messages never both read the same question. */
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(conversationId: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(conversationId) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(conversationId, next);
  void next.catch(() => undefined).finally(() => {
    if (queues.get(conversationId) === next) queues.delete(conversationId);
  });
  return next;
}

const bodyOf = (out: Answer): string =>
  systemMessage("botfather", { text: out.text, ...(out.reveal ? { reveal: 1 } : {}), ...(out.ask ? { ask: encodeAsk(out.ask) } : {}), ...(out.kb?.length ? { kb: encodeKeyboard(out.kb) } : {}) });

const metaOf = (body: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(body) as { k?: unknown; p?: unknown } | null;
    return parsed?.k === "botfather" && parsed.p && typeof parsed.p === "object" ? (parsed.p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** How long a question waits for its answer. */
const ASK_TTL_MS = 10 * 60_000;

/** What is being waited for: the question of the LAST line, while it is fresh. It lives in the line itself, so a restart loses nothing. */
async function pendingAsk(conversationId: string): Promise<BotAsk | null> {
  const line = await db.chatMessage.findFirst({ where: { conversationId, kind: "SYSTEM", clientId: { startsWith: "botfather:" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { body: true, createdAt: true } });
  if (!line || Date.now() - line.createdAt.getTime() > ASK_TTL_MS) return null;
  return decodeAsk(metaOf(line.body)["ask"]);
}

async function writeLine(input: { orgId: string; conversationId: string; authorId: string; spaceId: string | null; clientId: string }, out: Answer): Promise<void> {
  const id = await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({
      data: { orgId: input.orgId, conversationId: input.conversationId, authorId: input.authorId, body: bodyOf(out), kind: "SYSTEM", clientId: input.clientId },
      select: { id: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
    await moveLastMessageAt(tx, input.conversationId, msg.createdAt);
    await emitRealtime(tx, input.orgId, "message.created", { conversationId: input.conversationId, messageId: msg.id, ...(input.spaceId ? { spaceId: input.spaceId } : {}) });
    return msg.id;
  });
  if (out.reveal) stash(id, input.authorId, input.conversationId, out.reveal);
}

/** A menu button redraws the very message it is under. */
async function redrawLine(input: { orgId: string; conversationId: string; authorId: string; spaceId: string | null; messageId: string }, out: Answer): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.chatMessage.update({ where: { id: input.messageId }, data: { body: bodyOf(out) } });
    await emitRealtime(tx, input.orgId, "message.edited", { conversationId: input.conversationId, messageId: input.messageId, ...(input.spaceId ? { spaceId: input.spaceId } : {}) });
  });
  if (out.reveal) stash(input.messageId, input.authorId, input.conversationId, out.reveal);
}

/** What a pressed button does. `append`: it asks something, so it is a new line (the next message answers it); else the pressed line is redrawn. */
async function pressed(ctx: OrgAccessContext, data: string): Promise<{ out: Answer; append: boolean }> {
  const [op, a = "", b = ""] = data.split(":");
  const redraw = (out: Answer) => ({ out, append: false });
  switch (op) {
    case "bots":
      return redraw(await listView(ctx));
    case "new":
      await listBots(ctx);
      return { out: askNewBotName(), append: true };
    case "bot":
      return redraw(menuView(await findBot(ctx, a)));
    case "tk":
      return redraw(tokenView(await findBot(ctx, a)));
    case "tkn":
      return redraw({ ...(await act(ctx, "token", a, "")), kb: backTo(`bot:${a}`) });
    case "rv":
      return redraw({ ...(await act(ctx, "revoke", a, "")), kb: backTo(`bot:${a}`) });
    case "edit":
      return redraw(editView(await findBot(ctx, a)));
    case "set":
      return redraw(settingsView(await findBot(ctx, a)));
    case "jg":
      return redraw(joinView(await findBot(ctx, a)));
    case "pm":
      return redraw(privacyView(await findBot(ctx, a)));
    case "jgset":
      return redraw(joinView(await setBotFlag(ctx, a, "joinGroups", b === "1")));
    case "pmset":
      return redraw(privacyView(await setBotFlag(ctx, a, "privacyMode", b === "1")));
    case "del":
      return redraw(confirmDeleteView((await findBot(ctx, a)).username));
    case "delok":
      return redraw({ ...(await act(ctx, "deletebot", a, "confirm")), kb: backTo("bots") });
    case "ask":
    case "pick":
      if (!isBotTargetCommand(a)) throw new NotFoundError("chat.e.not_found");
      return { out: await act(ctx, a, b, ""), append: true };
    default:
      throw new NotFoundError("chat.e.not_found");
  }
}

/** A press of a button under a line: only by the person of the chat, only a button that line really has, and only while they may still make bots. */
export async function pressBotButton(ctx: OrgAccessContext, messageId: string, data: string): Promise<void> {
  const line = await db.chatMessage.findFirst({ where: { id: messageId, orgId: ctx.orgId, kind: "SYSTEM" }, select: { conversationId: true, conversation: { select: { dmKey: true, spaceId: true } } } });
  if (!line || !isBotFatherChatOf(line.conversation.dmKey, ctx.userId)) throw new NotFoundError("chat.e.not_found");
  await assertFeatureOn(ctx.orgId, "botFather");
  const me = await loadOrgFacts(ctx.userId, ctx.orgId);
  if (!me || me.status !== "ACTIVE" || (me.role !== "OWNER" && me.role !== "ADMIN")) throw new ForbiddenError("bots.not_allowed");
  await inTurn(line.conversationId, async () => {
    // read again inside the turn: a press just before this one may have redrawn the line
    const now = await db.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: { body: true } });
    if (!decodeKeyboard(metaOf(now.body)["kb"]).some((row) => row.some((x) => x.d === data))) throw new NotFoundError("chat.e.not_found");
    let result: { out: Answer; append: boolean };
    try {
      result = await pressed(ctx, data);
    } catch (err) {
      // a bot that is gone since the menu was drawn: say so in its place
      if (!(err instanceof NotFoundError && err.message === "bots.not_found") && !(err instanceof ValidationError)) throw err;
      result = { out: { text: failureText(err), kb: backTo("bots") }, append: false };
    }
    const where = { orgId: ctx.orgId, conversationId: line.conversationId, authorId: ctx.userId, spaceId: line.conversation.spaceId };
    if (result.append) await writeLine({ ...where, clientId: `botfather:press:${randomUUID()}` }, result.out);
    else await redrawLine({ ...where, messageId }, result.out);
  });
}

const jobs = new Set<Promise<unknown>>();

/** After a text message was stored: if it was written in the sender's own chat with «بوت فاذر», answer it (never delays the send). */
export function afterBotFatherMessage(input: { orgId: string; conversationId: string; messageId: string; authorId: string; body: string }): void {
  const job = inTurn(input.conversationId, () => answer(input)).catch((err: unknown) => log.error("botfather.crashed", { name: err instanceof Error ? err.name : "unknown" }));
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

async function answer(input: { orgId: string; conversationId: string; messageId: string; authorId: string; body: string }): Promise<void> {
  const conv = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { dmKey: true, spaceId: true } });
  // only the person the chat belongs to wakes it
  if (!conv || !isBotFatherChatOf(conv.dmKey, input.authorId)) return;
  const me = await loadOrgFacts(input.authorId, input.orgId);
  const ctx: OrgAccessContext = { orgId: input.orgId, userId: input.authorId, orgRole: (me?.role ?? "GUEST") as OrgAccessContext["orgRole"] };
  const waiting = await pendingAsk(input.conversationId);
  const picture = waiting?.c === "setavatar" ? await db.messageAttachment.findFirst({ where: { messageId: input.messageId, kind: "IMAGE" }, orderBy: { position: "asc" }, select: { fileId: true, name: true } }) : null;
  // a picture or a file with no words, while nothing waits for it, is only a message: nothing to answer
  if (!picture && input.body.trim() === "") return;
  const call = parseBotFatherCall(input.body);
  let out: Answer;
  if (picture && waiting?.u) out = await applyAvatar(ctx, input.orgId, waiting.u, picture);
  else if (waiting && call.command === "cancel") out = { text: t("botfather.cancel_done") };
  else if (waiting && !interruptsAsk(input.body, waiting)) out = await inWords(() => reply(ctx, waiting, input.body, conv.spaceId));
  else out = await runBotFatherCall(ctx, call, conv.spaceId);
  await writeLine({ orgId: input.orgId, conversationId: input.conversationId, authorId: input.authorId, spaceId: conv.spaceId, clientId: `botfather:${input.messageId}` }, out);
}


/** The picture the person sent becomes the bot's face; a picture the rules refuse is a plain sentence, not a crash. */
async function applyAvatar(ctx: OrgAccessContext, orgId: string, username: string, image: { fileId: string; name: string | null }): Promise<Answer> {
  try {
    const stored = await readStored(orgId, image.fileId);
    const bot = await setBotAvatar(ctx, username, { name: image.name ?? stored.name, bytes: new Uint8Array(stored.buffer) });
    return { text: t("botfather.avatar_done", { username: bot.username }) };
  } catch (err) {
    if (err instanceof ForbiddenError && err.message.startsWith("avatar.")) return { text: t("botfather.avatar_failed") };
    return { text: failureText(err) };
  }
}

/** Tests: wait until every message to «بوت فاذر» has been answered. */
export async function settleBotFatherForTests(): Promise<void> {
  while (jobs.size > 0) await Promise.all([...jobs]);
}
