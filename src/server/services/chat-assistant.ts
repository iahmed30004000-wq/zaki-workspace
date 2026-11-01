import { AR } from "@/lib/i18n/dict";
import { ASSISTANT_MENTION_NAME, mentionsAssistant } from "@/lib/chat/conversation/mentions";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { AssistantError } from "@/server/ai/api";
import { AiProviderError } from "@/server/ai/provider";
import { LOCAL_MAX_OUTPUT_TOKENS, LOCAL_WINDOW } from "@/server/ai/local-transport";
import { makeProvider } from "@/server/ai/registry";
import { capText } from "@/server/ai/redact";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_SYSTEM_PROMPT, REPLY_MAX_CHARS, buildChatPrompt, type ChatRow } from "@/server/ai/redact-chat";
import { systemMessage } from "@/server/chat/system";
import { canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { isLocalKind, providerReady, resolveProvider } from "@/server/services/assistant-provider";
import { assertWithinQuota, getSettings, recordUsage, usageSummary } from "@/server/services/owner-assistant-settings";
import { dayKeyOf } from "@/lib/owner-board";

/**
 * «@المساعد» في الدردشة والتوبكس — the owner's assistant as a mentionable participant. ONE answer per mention, in the same conversation.
 *
 *   WHEN     only when a message carries «@المساعد» as a whole word, and only for the message's author. Nothing else wakes it: not a
 *            reply, not an edit, not a keyword, not a schedule. Switched off, a typed mention is plain text and nothing happens.
 *   WHO      an ACTIVE staff member who can read (and has just posted in) the conversation. A guest / partner never can. A conversation
 *            that has a guest among its people is REFUSED, in Arabic, in the conversation: the guest must never be near the model.
 *   WHAT     the last 30 messages of THAT conversation (never another one, never an attachment, never the owner board, never a DM
 *            it was not mentioned in), text only, through `buildChatPrompt`: phones, e-mails, links, handles, secrets and
 *            addresses masked, staff as «زميل n» unless the owner allowed names. One call to the owner's key, no tools: the model
 *            can only talk, it can never create, change or send anything. A task or reminder it suggests is words.
 *   WHERE    the answer is an ordinary line of the conversation (`kind` SYSTEM, `{k:"assistant", p:{text}}`), so it follows the
 *            conversation's own visibility: the people who read the conversation read it, nobody else, and the owner's silent
 *            reading is unchanged. It is authored by the asker's row only because a row needs an author; the screen draws it as «المساعد».
 *   TRACE    the audit log gets one row per mention: who, which conversation, how many messages and characters, how many pieces were
 *            masked, the outcome. NEVER the prompt, NEVER the answer. Append-only: this file only creates audit rows.
 *   LIMITS   5 mentions a minute per person and 5 per conversation, the company's daily limit and monthly token budget of «مساعد المالك»,
 *            a 60 second timeout. A failure is a short Arabic sentence in the conversation, never a stack and never the words.
 *   ONCE     the answer's `clientId` is `assistant:<message id>`, which the unique (author, clientId) of a chat message makes
 *            exactly-once: a second delivery of the same mention finds it and stops.
 *
 * ⚠️ An external model reads redacted chat text. 🔧 The first answer of every conversation says so in the conversation itself.
 */

export const ASK_LIMIT_PER_MINUTE = 5;
export const askLimiter = new FixedWindowLimiter({ limit: ASK_LIMIT_PER_MINUTE, windowMs: 60_000 });
export const conversationLimiter = new FixedWindowLimiter({ limit: ASK_LIMIT_PER_MINUTE, windowMs: 60_000 });
/** The refusal for «too many» is itself said once a minute per conversation, so it cannot be used to flood the conversation. */
const noticeLimiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });

/** How the body of an assistant line starts (`systemMessage` writes `{"k":…`): how the lines are found without parsing every row. */
export const ASSISTANT_BODY_PREFIX = '{"k":"assistant"';
export const replyClientId = (messageId: string): string => `assistant:${messageId}`;

export type AssistantOutcome =
  | { outcome: "off" } // a switch is off: nothing happens
  | { outcome: "ignored" } // not a message, not an asker, not somebody who may: nothing happens
  | { outcome: "duplicate" } // already answered (or being answered)
  | { outcome: "limited"; said: boolean } // too many mentions; `said`: the conversation was told
  | { outcome: "refused"; reason: RefusalReason }
  | { outcome: "answered"; messageId: string };

export type RefusalReason = "guest" | "no_key" | "no_local" | "daily" | "monthly" | "key_rejected" | "request" | "busy" | "failed" | "local_busy" | "local_down" | "local_missing" | "local_timeout" | "local_host";

/** The sentence of each refusal: a dictionary key per reason. */
const REFUSAL_KEY: Record<RefusalReason | "limited_user" | "limited_conversation", string> = {
  guest: "chatai.err.guest",
  no_key: "chatai.err.no_key",
  no_local: "chatai.err.no_local",
  daily: "chatai.err.daily",
  monthly: "chatai.err.monthly",
  key_rejected: "chatai.err.key_rejected",
  request: "chatai.err.request",
  busy: "chatai.err.busy",
  failed: "chatai.err.failed",
  local_busy: "chatai.err.local_busy",
  local_down: "chatai.err.local_down",
  local_missing: "chatai.err.local_missing",
  local_timeout: "chatai.err.local_timeout",
  local_host: "chatai.err.local_host",
  limited_user: "chatai.err.rate_user",
  limited_conversation: "chatai.err.rate_conversation",
};

function reasonOfProviderError(key: string): RefusalReason {
  if (key === "assistant.err_key_rejected") return "key_rejected";
  if (key === "assistant.err_request") return "request";
  if (key === "assistant.err_rate_limited" || key === "assistant.err_overloaded") return "busy";
  if (key === "assistant.err_local_busy") return "local_busy";
  if (key === "assistant.err_local_down") return "local_down";
  if (key === "assistant.err_local_missing") return "local_missing";
  if (key === "assistant.err_local_timeout") return "local_timeout";
  if (key === "assistant.err_local_host") return "local_host";
  return "failed";
}

// ───────────────────────────────────────── is it offered ─────────────────────────────────────────

/**
 * Is the assistant in the «@» list of this company's chats? Both switches on and the owner's key saved. (A typed mention without the key
 * still gets a plain Arabic answer in the conversation: the key can be removed between the list and the send.)
 */
export async function chatAssistantOffered(orgId: string): Promise<boolean> {
  if (!(await isFeatureOn(orgId, "chatAssistant")) || !(await isFeatureOn(orgId, "ownerAssistant"))) return false;
  return providerReady(await getSettings(orgId), "chat");
}

// ───────────────────────────────────────── the guest rule ─────────────────────────────────────────

/**
 * Does the conversation have a guest among the people it reaches? Its own rows, and for an open topic its whole space; a guest by the
 * company's rank, or by the space's. The check over-approximates on purpose (a «مقطع» topic counts its space): a doubt is a refusal.
 */
export async function conversationHasGuest(facts: ConversationFacts, conversationId: string, orgId: string): Promise<boolean> {
  const rows = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  const ids = new Set(rows.map((r) => r.userId));
  if (facts.spaceId && facts.kind === "TOPIC") {
    const space = await db.workspaceMember.findMany({ where: { workspaceId: facts.spaceId }, select: { userId: true, role: true } });
    if (!facts.restricted) for (const r of space) ids.add(r.userId);
    // a person whose row in the space is «ضيف» is a guest of the conversation even if the company ranks them higher
    if (space.some((r) => r.role === "GUEST" && (!facts.restricted || ids.has(r.userId)))) return true;
  }
  if (ids.size === 0) return false;
  const guests = await db.organizationMember.count({ where: { organizationId: orgId, userId: { in: [...ids] }, role: "GUEST", status: "ACTIVE" } });
  return guests > 0;
}

// ───────────────────────────────────────── writing the line ─────────────────────────────────────────

interface Line {
  text: string;
  /** a refusal: the reason (the screen draws it as a notice, not as an answer) */
  err?: RefusalReason | "limited";
  first?: boolean;
  read?: number;
  /** a local model read the text (the screen names it instead of «an external model»); `relaxed`: with the relaxed filter */
  local?: boolean;
  relaxed?: boolean;
}

interface AuditFacts {
  outcome: "answered" | "refused" | "limited";
  reason?: string;
  readMessages?: number;
  charsSent?: number;
  charsReply?: number;
  masked?: number;
  model?: string;
  /** only for a local model: which kind answered (`ollama` / `openai`) and whether the relaxed filter was on */
  provider?: string;
  relaxed?: boolean;
}

async function postLine(
  ctx: { orgId: string; conversationId: string; messageId: string; askerId: string; spaceId: string | null },
  line: Line,
  audit: AuditFacts,
  usage?: { day: string; inputTokens: number; outputTokens: number },
): Promise<string | null> {
  const p: Record<string, string | number> = { text: line.text };
  if (line.err) p["err"] = line.err;
  if (line.first) p["first"] = 1;
  if (line.read !== undefined) p["read"] = line.read;
  if (line.local) p["local"] = 1;
  if (line.relaxed) p["relaxed"] = 1;
  try {
    return await db.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          orgId: ctx.orgId,
          conversationId: ctx.conversationId,
          authorId: ctx.askerId,
          body: systemMessage("assistant", p),
          kind: "SYSTEM",
          clientId: replyClientId(ctx.messageId),
        },
        select: { id: true },
      });
      await tx.conversation.update({ where: { id: ctx.conversationId }, data: { updatedAt: new Date() } });
      await emitRealtime(tx, ctx.orgId, "message.created", { conversationId: ctx.conversationId, messageId: msg.id, ...(ctx.spaceId ? { spaceId: ctx.spaceId } : {}) });
      await tx.auditLog.create({
        data: {
          action: "chat.assistant_asked",
          actorId: ctx.askerId,
          orgId: ctx.orgId,
          target: ctx.messageId,
          workspaceId: ctx.spaceId,
          conversationId: ctx.conversationId,
          // counters only: never the prompt, never the answer
          meta: { messageId: ctx.messageId, ...audit },
        },
      });
      if (usage) {
        await tx.aiUsage.upsert({
          where: { orgId_userId_day: { orgId: ctx.orgId, userId: ctx.askerId, day: usage.day } },
          create: { orgId: ctx.orgId, userId: ctx.askerId, day: usage.day, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, requests: 1 },
          update: { inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens }, requests: { increment: 1 } },
        });
      }
      return msg.id;
    });
  } catch (err) {
    // the one expected failure is the unique (author, clientId): a second delivery lost the race: nothing more to do
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") return null;
    throw err;
  }
}

// ───────────────────────────────────────── the answer ─────────────────────────────────────────

/** Mentions being answered right now in this process (a second delivery of the same message stops here). */
const inflight = new Set<string>();

/**
 * One mention. Everything is re-read from the database by the message id: the caller names a message, never a person, a
 * conversation's rights or a text. Never throws for an ordinary refusal; a `AiProviderError` becomes an Arabic line.
 */
export async function answerMention(input: { orgId: string; conversationId: string; messageId: string }, now: Date = new Date()): Promise<AssistantOutcome> {
  const { orgId, conversationId, messageId } = input;
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, orgId: true, conversationId: true, authorId: true, body: true, kind: true, deletedAt: true, createdAt: true } });
  if (!msg || msg.orgId !== orgId || msg.conversationId !== conversationId || msg.kind !== "TEXT" || msg.deletedAt || !mentionsAssistant(msg.body)) return { outcome: "ignored" };
  const askerId = msg.authorId;

  // 1. the switches: off means a typed mention is only text
  if (!(await isFeatureOn(orgId, "chatAssistant")) || !(await isFeatureOn(orgId, "ownerAssistant"))) return { outcome: "off" };

  // 2. the asker: ACTIVE staff who reads this conversation (a guest, a suspended person, a stranger: nothing happens)
  const org = await loadOrgFacts(askerId, orgId);
  if (!org || org.status !== "ACTIVE" || org.role === "GUEST") return { outcome: "ignored" };
  const facts = await loadConversationFacts(askerId, conversationId);
  if (!facts || facts.orgId !== orgId || !canRead(facts, org)) return { outcome: "ignored" };

  // 3. once: already answered, or being answered
  // (checked and taken in ONE synchronous step: two deliveries at the same moment cannot both pass)
  if (inflight.has(messageId)) return { outcome: "duplicate" };
  inflight.add(messageId);
  try {
    if (await db.chatMessage.findUnique({ where: { authorId_clientId: { authorId: askerId, clientId: replyClientId(messageId) } }, select: { id: true } })) return { outcome: "duplicate" };
    const ctx = { orgId, conversationId, messageId, askerId, spaceId: facts.spaceId };
    const refuse = async (reason: RefusalReason): Promise<AssistantOutcome> => {
      await postLine(ctx, { text: AR[REFUSAL_KEY[reason]] ?? "", err: reason }, { outcome: "refused", reason });
      return { outcome: "refused", reason };
    };

    // 4. the limits of mentions (every eligible mention counts, a refused one too)
    const askKey = `chatai.ask.${askerId}`;
    const convKey = `chatai.conv.${conversationId}`;
    const byUser = askLimiter.check(askKey).ok;
    const byConversation = conversationLimiter.check(convKey).ok;
    if (!byUser || !byConversation) {
      const said = noticeLimiter.check(convKey).ok;
      if (said) {
        noticeLimiter.hit(convKey);
        await postLine(ctx, { text: AR[REFUSAL_KEY[!byUser ? "limited_user" : "limited_conversation"]] ?? "", err: "limited" }, { outcome: "limited", reason: !byUser ? "user" : "conversation" });
      }
      return { outcome: "limited", said };
    }
    askLimiter.hit(askKey);
    conversationLimiter.hit(convKey);

    // 5. a guest among the people of the conversation: refused, said in the conversation
    if (await conversationHasGuest(facts, conversationId, orgId)) return refuse("guest");

    // 6. the owner's key and the company's quotas
    const settings = await getSettings(orgId);
    const choice = await resolveProvider(orgId, settings, "chat");
    if (!choice) return refuse(settings.chatProvider === "claude" ? "no_key" : "no_local");
    const local = isLocalKind(choice.kind);
    // names pass only for a local model with the owner's switch (`choice.relax`) or when he allowed names; Claude is never relaxed
    const allowNames = settings.allowNames || choice.relax;
    const day = dayKeyOf(now, await orgTimeZone(orgId));
    try {
      assertWithinQuota(await usageSummary(orgId, settings, now));
    } catch (err) {
      if (err instanceof AssistantError) return refuse(err.key === "assistant.monthly_budget" ? "monthly" : "daily");
      throw err;
    }

    // 7. what is sent: the last messages of THIS conversation, text only, filtered
    const window = await db.chatMessage.findMany({
      where: {
        conversationId,
        deletedAt: null,
        createdAt: { lte: msg.createdAt },
        OR: [{ kind: "TEXT" }, { kind: "SYSTEM", body: { startsWith: ASSISTANT_BODY_PREFIX } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: { id: true, authorId: true, body: true, kind: true, author: { select: { name: true } } },
    });
    const rows: ChatRow[] = [];
    for (const m of window.reverse()) {
      if (m.kind === "SYSTEM") {
        const said = assistantTextOf(m.body);
        if (said) rows.push({ id: m.id, authorId: "assistant", authorName: ASSISTANT_MENTION_NAME, body: said, fromAssistant: true });
      } else {
        rows.push({ id: m.id, authorId: m.authorId, authorName: m.author.name, body: m.body });
      }
    }
    const people = allowNames
      ? []
      : await db.organizationMember.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, select: { user: { select: { name: true } } }, take: 1000 });
    const prompt = buildChatPrompt(rows, {
      allowNames,
      askingMessageId: messageId,
      companyNames: people.map((p) => p.user.name),
      ...(choice.relax ? { relax: true } : {}),
      ...(local ? { windowMessages: LOCAL_WINDOW.messages, windowChars: LOCAL_WINDOW.chars } : {}),
    });

    // 8. the call: no tools, a bounded answer
    let completion;
    try {
      completion = await makeProvider(choice.config).complete({ system: CHAT_SYSTEM_PROMPT, messages: [{ role: "user", content: prompt.content }], maxTokens: local ? Math.min(CHAT_MAX_OUTPUT_TOKENS, LOCAL_MAX_OUTPUT_TOKENS) : CHAT_MAX_OUTPUT_TOKENS });
    } catch (err) {
      const key = err instanceof AiProviderError ? err.key : "unexpected";
      // the reason only: not the words, not the provider's body, not the key
      log.warn("chat_assistant.failed", { key, conversationId });
      return refuse(reasonOfProviderError(key));
    }

    // 9. the line
    const text = capText(completion.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim(), REPLY_MAX_CHARS) || (AR["chatai.reply_empty"] ?? "");
    const first = (await db.chatMessage.count({ where: { conversationId, kind: "SYSTEM", body: { startsWith: ASSISTANT_BODY_PREFIX } } })) === 0;
    const posted = await postLine(
      ctx,
      { text, first, read: prompt.messages, ...(local ? { local: true } : {}), ...(choice.relax ? { relaxed: true } : {}) },
      {
        outcome: "answered",
        readMessages: prompt.messages,
        charsSent: prompt.chars,
        charsReply: text.length,
        masked: prompt.maskedTotal,
        model: choice.model,
        ...(local ? { provider: choice.kind } : {}),
        ...(choice.relax ? { relaxed: true } : {}),
      },
      { day, inputTokens: completion.usage.inputTokens, outputTokens: completion.usage.outputTokens },
    );
    return posted ? { outcome: "answered", messageId: posted } : { outcome: "duplicate" };
  } finally {
    inflight.delete(messageId);
  }
}

/** The words of an earlier answer of the assistant (a refusal is not an answer and is not read back). */
export function assistantTextOf(body: string): string | null {
  try {
    const meta = JSON.parse(body) as { k?: unknown; p?: { text?: unknown; err?: unknown } };
    if (meta.k !== "assistant" || meta.p?.err || typeof meta.p?.text !== "string") return null;
    return meta.p.text;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────── the hook of sending ─────────────────────────────────────────

const jobs = new Set<Promise<unknown>>();

/**
 * Called by the send path AFTER the message is committed and its notifications are queued. It never delays the sender: the answer
 * is written when the model has answered, and appears live like any message. A body without «@المساعد» costs one string search.
 */
export function afterMessageSent(input: { orgId: string; conversationId: string; messageId: string; body: string }): void {
  if (input.body.length === 0 || !mentionsAssistant(input.body)) return;
  const job: Promise<unknown> = answerMention({ orgId: input.orgId, conversationId: input.conversationId, messageId: input.messageId }).catch((err: unknown) => {
    // the name of the error only: a message of it could hold a piece of the text
    log.error("chat_assistant.crashed", { name: err instanceof Error ? err.name : "unknown" });
  });
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

/** Tests: wait until every mention started by `afterMessageSent` has been answered. */
export async function settleChatAssistantForTests(): Promise<void> {
  while (jobs.size > 0) await Promise.all([...jobs]);
}

/** Tests: forget the limits of one person and one conversation. */
export function clearChatAssistantLimitsForTests(ids: { userId: string; conversationId: string }): void {
  askLimiter.reset(`chatai.ask.${ids.userId}`);
  conversationLimiter.reset(`chatai.conv.${ids.conversationId}`);
  noticeLimiter.reset(`chatai.conv.${ids.conversationId}`);
}
