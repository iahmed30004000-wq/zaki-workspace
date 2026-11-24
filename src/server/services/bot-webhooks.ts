import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { hmacHex } from "@/server/crypto";
import { callLocal, targetOf } from "@/server/ai/local-transport";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { isFeatureOn } from "@/server/services/features";
import { webhookSecretOf } from "@/server/services/bots";

/**
 * «بوت فاذر» — the webhook of a bot (docs/contracts/bots.md): the messages that ADDRESS a bot are sent to its address, signed.
 *
 *   WHICH   a text message in a conversation the bot is part of (a private chat with it; a topic of the space it belongs to, or a restricted topic it was added to), that either
 *           mentions it («@username») or starts with a slash command («/start» or «/start@username»). Never a message the bot wrote itself, never for a deleted bot, never while the
 *           switch \`botFather\` is off.
 *   WHAT    \`{ event: "message", delivery, bot, conversation, message, from, command?, mentioned }\`: the text of THAT message and who wrote it, nothing of the rest of the conversation.
 *           ⚠️ The text of a message is whatever the person typed: the address is the owner's own, typed in «بوت فاذر».
 *   HOW     one POST, five seconds at most, no retry. Headers: \`x-zaki-event\`, \`x-zaki-delivery\`, \`x-zaki-timestamp\` (seconds) and \`x-zaki-signature: sha256=<hex>\`, the HMAC-SHA256 of
 *           \`<timestamp>.<body>\` with the bot's secret (shown once when it was made or changed). The address is judged again on every call.
 *   FAILS   a failure is ONE row under «التكاملات» with a code (never the address, the text or the answer); the message itself is never touched.
 */

const TIMEOUT_MS = 5_000;

export interface BotMessageInput {
  orgId: string;
  conversationId: string;
  messageId: string;
  authorId: string;
  body: string;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the message says to this bot: is it addressed to it, and is it a command. Pure. */
export function addressedTo(body: string, username: string): { mentioned: boolean; command: { name: string; args: string } | null } {
  const mentioned = new RegExp(`(^|[^A-Za-z0-9_])@${escape(username)}(?![A-Za-z0-9_])`, "i").test(body);
  const m = /^\s*\/([A-Za-z][A-Za-z0-9_]{0,31})(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(body);
  // «/start@other_bot» is for another bot
  const command = m && (!m[2] || m[2].toLowerCase() === username.toLowerCase()) ? { name: m[1]!.toLowerCase(), args: (m[3] ?? "").trim() } : null;
  return { mentioned, command };
}

async function deliver(input: BotMessageInput): Promise<void> {
  if (!(await isFeatureOn(input.orgId, "botFather"))) return;
  const bots = await db.bot.findMany({ where: { orgId: input.orgId, deletedAt: null, webhookUrl: { not: null }, userId: { not: input.authorId } }, select: { id: true, userId: true, username: true, name: true, workspaceId: true, webhookUrl: true, webhookSecretCipher: true } });
  if (bots.length === 0) return;
  const conv = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { kind: true, spaceId: true, restricted: true, title: true, archivedAt: true, members: { select: { userId: true } } } });
  if (!conv || conv.archivedAt) return;
  const author = await db.user.findUnique({ where: { id: input.authorId }, select: { id: true, name: true } });
  if (!author) return;
  for (const bot of bots) {
    const memberIds = new Set(conv.members.map((m) => m.userId));
    const inside = conv.kind === "TOPIC" ? (conv.restricted ? memberIds.has(bot.userId) : conv.spaceId === bot.workspaceId) : memberIds.has(bot.userId);
    if (!inside) continue;
    const { mentioned, command } = addressedTo(input.body, bot.username);
    // a private chat with the bot is addressed to it whatever is written
    if (!mentioned && !command && conv.kind !== "DM") continue;
    await send(bot, { orgId: input.orgId, conversationId: input.conversationId, messageId: input.messageId, kind: conv.kind, title: conv.title, spaceId: conv.spaceId }, author, input.body, mentioned, command);
  }
}

async function send(
  bot: { id: string; username: string; name: string; webhookUrl: string | null; webhookSecretCipher: string | null },
  where: { orgId: string; conversationId: string; messageId: string; kind: string; title: string | null; spaceId: string | null },
  author: { id: string; name: string },
  text: string,
  mentioned: boolean,
  command: { name: string; args: string } | null,
): Promise<void> {
  const fail = async (code: string) => {
    log.warn("bot.webhook_failed", { botId: bot.id, code });
    await db.integrationEvent.create({ data: { orgId: where.orgId, direction: "OUT", type: "bot.webhook", status: "FAILED", detail: code } }).catch(() => undefined);
  };
  const secret = webhookSecretOf(bot.webhookSecretCipher);
  if (!bot.webhookUrl || !secret) return fail("bot.webhook.no_secret");
  let url: URL;
  try {
    url = new URL(bot.webhookUrl);
  } catch {
    return fail("bot.webhook.bad_url");
  }
  // judged again on every call: inside the server, or https at a public name
  const internal = parseLocalBaseUrl(url.origin);
  const external = !internal.ok && url.protocol === "https:" && parseLocalBaseUrl(url.origin, { external: true }).ok;
  if (!internal.ok && !external) return fail("bot.webhook.address_refused");
  const delivery = randomUUID();
  const body = JSON.stringify({
    event: "message",
    delivery,
    bot: { username: bot.username, name: bot.name },
    conversation: { id: where.conversationId, kind: where.kind, title: where.title, spaceId: where.spaceId },
    message: { id: where.messageId, text },
    from: { id: author.id, name: author.name },
    mentioned,
    ...(command ? { command } : {}),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const res = await callLocal({
      target: targetOf(url.origin, external),
      method: "POST",
      path: `${url.pathname}${url.search}`,
      // the very bytes that were signed
      raw: { bytes: new TextEncoder().encode(body), contentType: "application/json" },
      timeoutMs: TIMEOUT_MS,
      headers: {
        "x-zaki-event": "message",
        "x-zaki-delivery": delivery,
        "x-zaki-timestamp": timestamp,
        "x-zaki-signature": `sha256=${hmacHex(secret, `${timestamp}.${body}`)}`,
      },
    });
    if (res.status < 200 || res.status >= 300) await fail(`bot.webhook.http_${Math.min(res.status, 599)}`);
  } catch {
    await fail("bot.webhook.unreachable");
  }
}

const jobs = new Set<Promise<unknown>>();

/** After a text message was stored: send it to the bots it addresses (never delays the send; a crash is logged by name only). */
export function afterBotAddressed(input: BotMessageInput): void {
  const job = deliver(input).catch((err: unknown) => log.error("bot.webhook_crashed", { name: err instanceof Error ? err.name : "unknown" }));
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

/** Tests: wait until every delivery started by `afterBotAddressed` is done. */
export async function settleBotWebhooksForTests(): Promise<void> {
  while (jobs.size > 0) await Promise.all([...jobs]);
}
