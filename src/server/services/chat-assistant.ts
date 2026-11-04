import { AR } from "@/lib/i18n/dict";
import { ASSISTANT_MENTION_NAME, mentionsAssistant } from "@/lib/chat/conversation/mentions";
import { isAssistantChatKey, isAssistantChatOf } from "@/lib/chat/assistant-chat";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { AssistantError } from "@/server/ai/api";
import { AiProviderError } from "@/server/ai/provider";
import { LOCAL_MAX_OUTPUT_TOKENS, LOCAL_WINDOW } from "@/server/ai/local-transport";
import { makeProvider } from "@/server/ai/registry";
import { capText, redactTitle } from "@/server/ai/redact";
import { PROPOSE_TOOL } from "@/server/ai/actions";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_PROPOSE_PROMPT, CHAT_SYSTEM_PROMPT, CHAT_TOPICS_PROMPT, CHAT_WORK_PROMPT, REPLY_MAX_CHARS, buildChatPrompt, type ChatRow } from "@/server/ai/redact-chat";
import { systemMessage } from "@/server/chat/system";
import { canRead, loadConversationFacts, loadOrgFacts, type ConversationFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { isFeatureOn } from "@/server/services/features";
import { loadAssistantWork } from "@/server/services/assistant-work";
import { restorerFor } from "@/server/services/owner-assistant-names";
import { prepareProposals, saveProposals } from "@/server/services/owner-assistant-proposals";
import { orgTimeZone } from "@/server/services/org-day";
import { providerReady, resolveProvider, runsOnOwnServer } from "@/server/services/assistant-provider";
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

export function reasonOfProviderError(key: string): RefusalReason {
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
export async function conversationHasGuest(facts: Pick<ConversationFacts, "kind" | "spaceId" | "restricted">, conversationId: string, orgId: string): Promise<boolean> {
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
  /** the proposals this answer made (ids of `AiProposal`, shown as cards with «وافق» / «ارفض») */
  props?: string[];
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
  if (line.props && line.props.length > 0) p["props"] = line.props.join(",");
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

/** Is this the author's OWN conversation with the assistant (its key names them), and is the contact's switch on? */
async function inOwnAssistantChat(orgId: string, conversationId: string, authorId: string): Promise<boolean> {
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { orgId: true, kind: true, dmKey: true } });
  if (!conv || conv.orgId !== orgId || conv.kind !== "TOPIC" || !isAssistantChatOf(conv.dmKey, authorId)) return false;
  return isFeatureOn(orgId, "assistantContact");
}

/**
 * The proposals of one answer, kept as the owner's own `AiProposal` rows (the SAME table, routes and rules as «مساعد المالك»: «وافق» runs it once,
 * through the ordinary services, as him). A conversation of the owner assistant is made for them so the references can be resolved later.
 */
async function keepProposals(input: { orgId: string; userId: string; refs: Record<string, string>; text: string; calls: readonly { name: string; input: unknown }[]; now: Date }): Promise<string[]> {
  if (input.calls.length === 0) return [];
  const prepared = await prepareProposals(input.orgId, input.refs, input.calls);
  if (prepared.items.length === 0) return [];
  return db.$transaction(async (tx) => {
    const conv = await tx.aiConversation.create({ data: { orgId: input.orgId, userId: input.userId, title: AR["chatai.proposals_title"] ?? "", refs: input.refs, createdAt: input.now, updatedAt: input.now }, select: { id: true } });
    const answer = await tx.aiMessage.create({ data: { conversationId: conv.id, role: "ASSISTANT", content: input.text, createdAt: input.now }, select: { id: true } });
    return saveProposals(tx, { orgId: input.orgId, conversationId: conv.id, messageId: answer.id }, prepared.items);
  });
}

const TOPICS_MAX = 4;
const TOPIC_MESSAGES = 6;
const TOPIC_CHARS = 1_000;

/**
 * What was said lately in the company's open topics, for the OWNER's own conversation: the newest topics, their last 8 text messages each,
 * through the SAME chat filter as a mention (phones, e-mails, links, secrets masked; staff as «زميل n» unless names are allowed). Never a DM, never
 * another assistant conversation, never a conversation a guest can reach (a doubt is a skip), never an attachment.
 */
async function topicsDigest(
  orgId: string,
  askerId: string,
  exceptId: string,
  options: { allowNames: boolean; companyNames: readonly string[]; relax: boolean },
): Promise<{ text: string; masked: number } | null> {
  const topics = await db.conversation.findMany({
    where: { orgId, kind: "TOPIC", closedAt: null, dmKey: null, id: { not: exceptId } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: TOPICS_MAX * 2,
    select: { id: true, title: true },
  });
  const parts: string[] = [];
  let masked = 0;
  for (const topic of topics) {
    if (parts.length >= TOPICS_MAX) break;
    const facts = await loadConversationFacts(askerId, topic.id);
    if (!facts || facts.orgId !== orgId || (await conversationHasGuest(facts, topic.id, orgId))) continue;
    const window = await db.chatMessage.findMany({
      where: { conversationId: topic.id, deletedAt: null, kind: "TEXT" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TOPIC_MESSAGES,
      select: { id: true, authorId: true, body: true, author: { select: { name: true } } },
    });
    if (window.length === 0) continue;
    const rows: ChatRow[] = window.reverse().map((m) => ({ id: m.id, authorId: m.authorId, authorName: m.author.name, body: m.body }));
    const prompt = buildChatPrompt(rows, { allowNames: options.allowNames, askingMessageId: "", companyNames: options.companyNames, ...(options.relax ? { relax: true } : {}), windowMessages: TOPIC_MESSAGES, windowChars: TOPIC_CHARS });
    const lines = /<chat>\n([\s\S]*?)\n<\/chat>/.exec(prompt.content)?.[1] ?? "";
    if (!lines) continue;
    const title = redactTitle(topic.title ?? "");
    masked += prompt.maskedTotal + title.count;
    parts.push(`[${title.text}]\n${lines}`);
  }
  return parts.length > 0 ? { text: parts.join("\n\n"), masked } : null;
}

/** Mentions being answered right now in this process (a second delivery of the same message stops here). */
const inflight = new Set<string>();

/**
 * One mention. Everything is re-read from the database by the message id: the caller names a message, never a person, a
 * conversation's rights or a text. Never throws for an ordinary refusal; a `AiProviderError` becomes an Arabic line.
 */
export async function answerMention(input: { orgId: string; conversationId: string; messageId: string }, now: Date = new Date()): Promise<AssistantOutcome> {
  const { orgId, conversationId, messageId } = input;
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, orgId: true, conversationId: true, authorId: true, body: true, kind: true, deletedAt: true, createdAt: true } });
  if (!msg || msg.orgId !== orgId || msg.conversationId !== conversationId || msg.kind !== "TEXT" || msg.deletedAt) return { outcome: "ignored" };
  // a mention wakes it anywhere; with no «@», only the person's OWN conversation with the assistant does («المساعد» in the people lists)
  if (!mentionsAssistant(msg.body) && !(await inOwnAssistantChat(orgId, conversationId, msg.authorId))) return { outcome: "ignored" };
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
    const local = runsOnOwnServer(choice);
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

    // 7b. in the person's OWN conversation with the assistant, their work picture rides along (src/server/services/assistant-work.ts)
    const work = (await inOwnAssistantChat(orgId, conversationId, askerId))
      ? await loadAssistantWork({ orgId, userId: askerId, role: org.role }, { allowNames, allowTitles: settings.allowTitles, local, now }).catch((err: unknown) => {
          // the name of the error only: the picture is simply missing from this answer
          log.warn("chat_assistant.work_failed", { name: err instanceof Error ? err.name : "unknown" });
          return null;
        })
      : null;
    // the OWNER's own conversation also reads what was said lately in the company's open topics (never a DM, never one a guest can reach)
    const topics = work?.canPropose && !local ? await topicsDigest(orgId, askerId, conversationId, { allowNames, companyNames: people.map((p) => p.user.name), relax: choice.relax === true }).catch(() => null) : null;
    const proposing = work?.canPropose === true && (await isFeatureOn(orgId, "assistantProposals"));
    const content = work ? `<work>\n${work.text}\n</work>\n\n${topics ? `<topics>\n${topics.text}\n</topics>\n\n` : ""}${prompt.content}` : prompt.content;
    if (work) log.info("chat_assistant.sizes", { work: work.text.length, topics: topics?.text.length ?? 0, chat: prompt.chars });

    // 8. the call: no tools, a bounded answer
    let completion;
    try {
      completion = await makeProvider(choice.config).complete({ system: work ? [CHAT_SYSTEM_PROMPT, CHAT_WORK_PROMPT, ...(proposing ? [CHAT_PROPOSE_PROMPT] : []), ...(topics ? [CHAT_TOPICS_PROMPT] : [])].join("\n") : CHAT_SYSTEM_PROMPT, messages: [{ role: "user", content }], ...(proposing ? { tools: [{ name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description, inputSchema: PROPOSE_TOOL.inputSchema as unknown as Record<string, unknown> }] } : {}), maxTokens: local ? Math.min(CHAT_MAX_OUTPUT_TOKENS, LOCAL_MAX_OUTPUT_TOKENS) : CHAT_MAX_OUTPUT_TOKENS });
    } catch (err) {
      const key = err instanceof AiProviderError ? err.key : "unexpected";
      // the reason only: not the words, not the provider's body, not the key
      log.warn("chat_assistant.failed", { key, conversationId });
      return refuse(reasonOfProviderError(key));
    }

    // 9. the line
    let text = capText(completion.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim(), REPLY_MAX_CHARS) || (AR["chatai.reply_empty"] ?? "");
    // the owner's own conversation: «موظف 2» / T5 are put back as the names and titles they stand for (it is his line, nobody else's)
    let props: string[] = [];
    if (work?.canPropose && Object.keys(work.refs).length > 0) {
      try {
        text = (await restorerFor(orgId, work.refs, [text])).restore(text);
        if (proposing) props = await keepProposals({ orgId, userId: askerId, refs: work.refs, text, calls: completion.toolCalls, now });
      } catch (err) {
        log.warn("chat_assistant.proposals_failed", { name: err instanceof Error ? err.name : "unknown" });
      }
    }
    const first = (await db.chatMessage.count({ where: { conversationId, kind: "SYSTEM", body: { startsWith: ASSISTANT_BODY_PREFIX } } })) === 0;
    const posted = await postLine(
      ctx,
      { text, first, read: prompt.messages, ...(props.length > 0 ? { props } : {}), ...(local ? { local: true } : {}), ...(choice.relax ? { relaxed: true } : {}) },
      {
        outcome: "answered",
        readMessages: prompt.messages,
        charsSent: content.length,
        charsReply: text.length,
        masked: prompt.maskedTotal + (work?.masked ?? 0),
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
  if (input.body.length === 0) return;
  const answer = (): Promise<unknown> =>
    answerMention({ orgId: input.orgId, conversationId: input.conversationId, messageId: input.messageId }).catch((err: unknown) => {
      // the name of the error only: a message of it could hold a piece of the text
      log.error("chat_assistant.crashed", { name: err instanceof Error ? err.name : "unknown" });
    });
  // no «@»: one cheap read of the conversation's key (off the sender's path) says whether it is somebody's conversation with the assistant
  const job: Promise<unknown> = mentionsAssistant(input.body)
    ? answer()
    : db.conversation
        .findUnique({ where: { id: input.conversationId }, select: { dmKey: true } })
        .then((c) => (isAssistantChatKey(c?.dmKey) ? answer() : undefined))
        .catch(() => undefined);
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
