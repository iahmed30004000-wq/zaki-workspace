import { dayOfInstant } from "@/lib/due-day";
import { zonedDayStart } from "@/lib/zoned-time";
import { dayKeyOf } from "@/lib/owner-board";
import { AR } from "@/lib/i18n/dict";
import {
  DIGEST_LIMIT_PER_MINUTE,
  DIGEST_MAX_OUTPUT_TOKENS,
  DIGEST_MESSAGES,
  DIGEST_MESSAGE_CHARS,
  DIGEST_OPEN_TOPIC_HOURS,
  DIGEST_REPLY_MAX_CHARS,
  DIGEST_SYSTEM_PROMPT,
  DIGEST_TASKS_MAX,
  DIGEST_TASK_CHANGED_HOURS,
  DIGEST_TASK_TITLE_CHARS,
  DIGEST_TOPICS_MAX,
  DIGEST_UNREAD_DAYS,
  TOPIC_SUMMARY_MESSAGES,
  TOPIC_SUMMARY_SYSTEM_PROMPT,
  TOPIC_SUMMARY_WINDOW_CHARS,
  cacheIsFresh,
  chatLinesOf,
  taskLine,
} from "@/lib/digest/rules";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { NotFoundError } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { AiProviderError } from "@/server/ai/provider";
import { LOCAL_MAX_OUTPUT_TOKENS, LOCAL_WINDOW } from "@/server/ai/local-transport";
import { makeProvider } from "@/server/ai/registry";
import { capText, maskKnownNames, redactTitle } from "@/server/ai/redact";
import { buildChatPrompt, redactChatText, type ChatRow } from "@/server/ai/redact-chat";
import type { Actor } from "@/server/policy/actor";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { providerReady, resolveProvider, runsOnOwnServer, type ResolvedProvider } from "@/server/services/assistant-provider";
import { conversationHasGuest, reasonOfProviderError } from "@/server/services/chat-assistant";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { assertWithinQuota, getSettings, usageSummary, type PublicSettings } from "@/server/services/owner-assistant-settings";

/**
 * «شو فاتني؟» — a short catch-up written by the owner's assistant for ONE person, on «اليوم», and «لخّصلي» inside a topic.
 *
 *   WHEN     only when the person asks: the card of «اليوم» fetches it after the page is drawn (the page never waits for the model), «حدّث»
 *            asks again, «لخّصلي» asks for one topic. Nothing runs on a schedule and nothing is pushed.
 *   WHO      an ACTIVE member of staff. A partner (GUEST) never: for them it does not exist (404). Needs «ملخّص شو فاتني» AND «مساعد المالك»
 *            AND «قراءة الدردشات للمساعد» on, and a provider that is ready.
 *   WHAT     only what the person may already read:
 *              tasks     their own (assigned or shared with them) that changed in the last 48 hours or are late, in spaces they can open,
 *                        never a reward task, at most 20, the title filtered and cut at 80 characters;
 *              topics    the topics they are in (a row of theirs) with messages newer than their read mark, and the open topics of the spaces
 *                        THEY are in with messages of the last 24 hours; at most 6 topics × 8 messages × 400 characters. Never a private chat,
 *                        never the assistant's own conversation, never a topic they cannot read (`canRead`), never a conversation a guest can
 *                        reach (`conversationHasGuest`: a doubt is a skip), never an archived topic or one they muted. The OWNER's silent reading
 *                        is not used here: for him the topics are only those he is in.
 *            Text goes through `buildChatPrompt` (phones, e-mails, links, handles, secrets, addresses masked; people as «زميل n» unless the
 *            owner allowed names), titles through the same filters. One call to the owner's provider, no tools, a bounded answer.
 *   KEPT     the model's short answer (not the material) in `DigestCache` for 3 hours and for the same company day: opening the page again
 *            does not ask the model again. «حدّث» ignores the cache.
 *   TRACE    one audit row per call: counters only (topics, messages, tasks, characters, masked), never the material, never the answer.
 *   LIMITS   5 calls a minute per person (the cache hit is not a call), the company's daily limit and monthly token budget of «مساعد المالك».
 *
 * ⚠️ An external model reads redacted work text of the person's own spaces. 🔧 The card and the button say so, and «ملخّص شو فاتني» is off by default.
 */

export const digestLimiter = new FixedWindowLimiter({ limit: DIGEST_LIMIT_PER_MINUTE, windowMs: 60_000 });
export const clearDigestLimitsForTests = (userId: string): void => digestLimiter.reset(`digest.${userId}`);

export interface DigestAnswer {
  text: string;
  /** Nothing to catch up on: no model was called and nothing is kept. */
  empty: boolean;
  /** Served from the 3-hour cache. */
  cached: boolean;
  /** When the text was written (ISO), null when empty. */
  generatedAt: string | null;
}

const fail = (reason: string, code: "conflict" | "rate_limited" = "conflict"): AssistantError => new AssistantError(`digest.err.${reason}`, code);

// ───────────────────────────────────────── is it offered ─────────────────────────────────────────

/** The three switches and a ready provider. The card of «اليوم» and the topic button are drawn only when this is true. */
export async function digestOffered(orgId: string): Promise<boolean> {
  if (!(await isFeatureOn(orgId, "morningDigest")) || !(await isFeatureOn(orgId, "ownerAssistant")) || !(await isFeatureOn(orgId, "chatAssistant"))) return false;
  return providerReady(await getSettings(orgId), "chat");
}

/** Off means not found; a partner never has it. */
async function assertOffered(actor: Actor): Promise<void> {
  await assertFeatureOn(actor.orgId, "morningDigest");
  await assertFeatureOn(actor.orgId, "ownerAssistant");
  await assertFeatureOn(actor.orgId, "chatAssistant");
  if (actor.isExternal) throw new NotFoundError("chat.e.not_found");
}

// ───────────────────────────────────────── the call ─────────────────────────────────────────

export interface Prepared {
  settings: PublicSettings;
  choice: ResolvedProvider;
  local: boolean;
  allowNames: boolean;
  /** Every active person's name, to hide when names are not allowed. */
  names: string[];
  day: string;
}

/** The limits, the provider and the company's quotas, in the order that costs least. */
async function prepare(actor: Actor, now: Date): Promise<Prepared> {
  const key = `digest.${actor.userId}`;
  if (!digestLimiter.check(key).ok) throw fail("rate", "rate_limited");
  digestLimiter.hit(key);
  const settings = await getSettings(actor.orgId);
  const choice = await resolveProvider(actor.orgId, settings, "chat");
  if (!choice) throw fail(settings.chatProvider === "claude" ? "no_key" : "no_local");
  try {
    assertWithinQuota(await usageSummary(actor.orgId, settings, now));
  } catch (err) {
    if (err instanceof AssistantError) throw fail(err.key === "assistant.monthly_budget" ? "monthly" : "daily", "rate_limited");
    throw err;
  }
  const allowNames = settings.allowNames || choice.relax;
  const names = allowNames ? [] : (await db.organizationMember.findMany({ where: { organizationId: actor.orgId, status: "ACTIVE" }, select: { user: { select: { name: true } } }, take: 1000 })).map((m) => m.user.name);
  return { settings, choice, local: runsOnOwnServer(choice), allowNames, names, day: dayKeyOf(now, await orgTimeZone(actor.orgId)) };
}

async function ask(p: Prepared, system: string, content: string, label: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  try {
    const out = await makeProvider(p.choice.config).complete({
      system,
      messages: [{ role: "user", content }],
      maxTokens: p.local ? Math.min(DIGEST_MAX_OUTPUT_TOKENS, LOCAL_MAX_OUTPUT_TOKENS) : DIGEST_MAX_OUTPUT_TOKENS,
    });
    const text = capText(out.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim(), DIGEST_REPLY_MAX_CHARS) || (AR["digest.reply_empty"] ?? "");
    return { text, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens };
  } catch (err) {
    const key = err instanceof AiProviderError ? err.key : "unexpected";
    // the reason only: not the words, not the provider's body, not the key
    log.warn("digest.failed", { key, what: label });
    throw fail(reasonOfProviderError(key));
  }
}

/** The usage counter, the audit row (counters only) and, for the digest, the cache, in ONE transaction. */
async function record(
  actor: Actor,
  p: Prepared,
  audit: { action: string; target: string; conversationId?: string; workspaceId?: string | null; meta: Record<string, unknown> },
  usage: { inputTokens: number; outputTokens: number },
  cache: { text: string; at: Date } | null,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.aiUsage.upsert({
      where: { orgId_userId_day: { orgId: actor.orgId, userId: actor.userId, day: p.day } },
      create: { orgId: actor.orgId, userId: actor.userId, day: p.day, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, requests: 1 },
      update: { inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens }, requests: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        action: audit.action,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: audit.target,
        ...(audit.conversationId ? { conversationId: audit.conversationId } : {}),
        ...(audit.workspaceId ? { workspaceId: audit.workspaceId } : {}),
        // counters only: never the material, never the answer
        meta: { ...audit.meta, model: p.choice.model, ...(p.local ? { provider: p.choice.kind } : {}), ...(p.choice.relax ? { relaxed: true } : {}) } as object,
      },
    });
    if (cache) {
      await tx.digestCache.upsert({
        where: { orgId_userId: { orgId: actor.orgId, userId: actor.userId } },
        create: { orgId: actor.orgId, userId: actor.userId, text: cache.text, forDay: p.day, createdAt: cache.at },
        update: { text: cache.text, forDay: p.day, createdAt: cache.at },
      });
    }
  });
}

// ───────────────────────────────────────── the material ─────────────────────────────────────────

/** A task title as the model may see it: one line, people's names hidden unless allowed, then the chat filter (addresses too), cut at 80. */
function cleanTitle(raw: string, p: Pick<Prepared, "allowNames" | "names" | "choice">): { text: string; masked: number } {
  const first = redactTitle(raw);
  let masked = first.count;
  let text = first.text;
  if (!p.allowNames && p.names.length > 0) {
    const hidden = maskKnownNames(text, [{ label: "[اسم]", names: p.names }]);
    masked += hidden.count;
    text = hidden.text;
  }
  const r = redactChatText(text, p.choice.relax === true);
  masked += r.count;
  return { text: capText(r.text, DIGEST_TASK_TITLE_CHARS), masked };
}

export interface DigestMaterial {
  /** What is sent to the model (tasks, then topics). Empty string when there is nothing. */
  text: string;
  topics: number;
  messages: number;
  tasks: number;
  masked: number;
}

/** The person's own tasks that changed or are late. Only spaces they can open, never a reward task. */
async function taskSection(actor: Actor, p: Prepared, now: Date): Promise<{ lines: string[]; masked: number }> {
  const tz = await orgTimeZone(actor.orgId);
  const today = dayOfInstant(now, tz);
  const todayStart = zonedDayStart(now, tz);
  const since = new Date(now.getTime() - DIGEST_TASK_CHANGED_HOURS * 3_600_000);
  const spaces = await accessibleWorkspaceIds(actor.userId);
  if (spaces.length === 0) return { lines: [], masked: 0 };
  const mine = { OR: [{ assigneeId: actor.userId }, { coAssignees: { some: { userId: actor.userId } } }] };
  const noReward = { OR: [{ rewardStatus: null }, { rewardStatus: { notIn: ["OPEN", "AWARDED"] } }] };
  const rows = await db.task.findMany({
    where: {
      orgId: actor.orgId,
      archived: false,
      workspaceId: { in: spaces },
      AND: [mine, noReward, { OR: [{ completedAt: null, dueDate: { lt: todayStart } }, { updatedAt: { gte: since } }] }],
    },
    select: { title: true, priority: true, dueDate: true, completedAt: true, creatorId: true, createdAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: DIGEST_TASKS_MAX * 2,
  });
  const lateOf = (t: { dueDate: Date | null; completedAt: Date | null }): boolean => t.completedAt === null && t.dueDate !== null && dayOfInstant(t.dueDate, tz) < today;
  // what is late comes first, then the newest change
  const chosen = [...rows.filter(lateOf), ...rows.filter((t) => !lateOf(t))].slice(0, DIGEST_TASKS_MAX);
  let masked = 0;
  const lines = chosen.map((t, i) => {
    const title = cleanTitle(t.title, p);
    masked += title.masked;
    return taskLine(
      `T${i + 1}`,
      { priority: t.priority, due: t.dueDate ? dayOfInstant(t.dueDate, tz) : null, completed: t.completedAt !== null, createdByOther: t.creatorId !== actor.userId, createdRecently: t.createdAt >= since },
      today,
      title.text,
    );
  });
  return { lines, masked };
}

/** The topics the person may read with something new in them (see the header of this file). */
async function topicSection(actor: Actor, p: Prepared, now: Date): Promise<{ parts: string[]; messages: number; masked: number }> {
  const org = await loadOrgFacts(actor.userId, actor.orgId);
  if (!org || org.status !== "ACTIVE" || org.role === "GUEST") return { parts: [], messages: 0, masked: 0 };
  // the spaces THEY are in (not `accessibleWorkspaceIds`: for the owner that is every space, and his silent reading is not used here)
  const spaceIds = (await db.workspaceMember.findMany({ where: { userId: actor.userId, workspace: { organizationId: actor.orgId } }, select: { workspaceId: true } })).map((r) => r.workspaceId);
  const unreadFloor = new Date(now.getTime() - DIGEST_UNREAD_DAYS * 86_400_000);
  const openFloor = new Date(now.getTime() - DIGEST_OPEN_TOPIC_HOURS * 3_600_000);
  const candidates = await db.conversation.findMany({
    where: {
      orgId: actor.orgId,
      kind: "TOPIC",
      dmKey: null, // never somebody's conversation with the assistant
      archivedAt: null,
      updatedAt: { gte: unreadFloor },
      OR: [{ members: { some: { userId: actor.userId } } }, { restricted: false, spaceId: { in: spaceIds } }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: DIGEST_TOPICS_MAX * 3,
    select: { id: true, title: true, members: { where: { userId: actor.userId }, select: { lastReadAt: true, mutedUntil: true } } },
  });
  const parts: string[] = [];
  let messages = 0;
  let masked = 0;
  for (const topic of candidates) {
    if (parts.length >= DIGEST_TOPICS_MAX) break;
    const mine = topic.members[0];
    if (mine?.mutedUntil && mine.mutedUntil > now) continue;
    // a read mark says exactly what is new; a topic known only through the space has none, so «the last day»
    const floor = mine ? new Date(Math.max(mine.lastReadAt.getTime(), unreadFloor.getTime())) : openFloor;
    const facts = await loadConversationFacts(actor.userId, topic.id);
    if (!facts || facts.orgId !== actor.orgId || facts.kind !== "TOPIC" || !canRead(facts, org) || (await conversationHasGuest(facts, topic.id, actor.orgId))) continue;
    const window = await db.chatMessage.findMany({
      where: { conversationId: topic.id, deletedAt: null, kind: "TEXT", createdAt: { gt: floor } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DIGEST_MESSAGES,
      select: { id: true, authorId: true, body: true, author: { select: { name: true } } },
    });
    // something new written by somebody else: the person's own words alone are nothing to catch up on
    if (!window.some((m) => m.authorId !== actor.userId)) continue;
    const rows: ChatRow[] = window.reverse().map((m) => ({ id: m.id, authorId: m.authorId, authorName: m.author.name, body: m.body }));
    const prompt = buildChatPrompt(rows, {
      allowNames: p.allowNames,
      askingMessageId: "",
      companyNames: p.names,
      ...(p.choice.relax ? { relax: true } : {}),
      windowMessages: DIGEST_MESSAGES,
      windowChars: DIGEST_MESSAGES * DIGEST_MESSAGE_CHARS,
      messageChars: DIGEST_MESSAGE_CHARS,
    });
    const lines = chatLinesOf(prompt.content);
    if (!lines) continue;
    const title = cleanTitle(topic.title ?? "", p);
    masked += prompt.maskedTotal + title.masked;
    messages += prompt.messages;
    parts.push(`[${title.text}]\n${lines}`);
  }
  return { parts, messages, masked };
}

/** Everything one digest reads, already filtered. Exported for the tests of «who gets what». */
export async function loadDigestMaterial(actor: Actor, p: Prepared, now: Date): Promise<DigestMaterial> {
  const [tasks, topics] = await Promise.all([taskSection(actor, p, now), topicSection(actor, p, now)]);
  if (tasks.lines.length === 0 && topics.parts.length === 0) return { text: "", topics: 0, messages: 0, tasks: 0, masked: 0 };
  const blocks: string[] = [];
  if (tasks.lines.length > 0) blocks.push(`<tasks>\n${tasks.lines.join("\n")}\n</tasks>`);
  if (topics.parts.length > 0) blocks.push(`<topics>\n${topics.parts.join("\n\n")}\n</topics>`);
  return { text: blocks.join("\n\n"), topics: topics.parts.length, messages: topics.messages, tasks: tasks.lines.length, masked: tasks.masked + topics.masked };
}

// ───────────────────────────────────────── «اليوم» ─────────────────────────────────────────

const inflight = new Map<string, Promise<DigestAnswer>>();

/**
 * The card of «اليوم»: the cached digest while it is under 3 hours old (and of today), else a new one. `refresh` ignores the cache («حدّث»).
 * Two requests of the same person at the same moment share one call.
 */
export async function morningDigest(actor: Actor, options: { refresh?: boolean } = {}, now: Date = new Date()): Promise<DigestAnswer> {
  await assertOffered(actor);
  const key = `${actor.orgId}:${actor.userId}:${options.refresh ? "r" : "c"}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = digestOnce(actor, options.refresh === true, now).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function digestOnce(actor: Actor, refresh: boolean, now: Date): Promise<DigestAnswer> {
  if (!refresh) {
    const today = dayKeyOf(now, await orgTimeZone(actor.orgId));
    const row = await db.digestCache.findUnique({ where: { orgId_userId: { orgId: actor.orgId, userId: actor.userId } }, select: { text: true, forDay: true, createdAt: true } });
    if (row && cacheIsFresh(row, now, today)) return { text: row.text, empty: false, cached: true, generatedAt: row.createdAt.toISOString() };
  }
  const p = await prepare(actor, now);
  const material = await loadDigestMaterial(actor, p, now);
  if (material.text === "") return { text: "", empty: true, cached: false, generatedAt: null };
  const answer = await ask(p, DIGEST_SYSTEM_PROMPT, material.text, "digest");
  await record(
    actor,
    p,
    { action: "digest.generated", target: actor.userId, meta: { refresh, topics: material.topics, messages: material.messages, tasks: material.tasks, charsSent: material.text.length, charsReply: answer.text.length, masked: material.masked } },
    answer,
    { text: answer.text, at: now },
  );
  return { text: answer.text, empty: false, cached: false, generatedAt: now.toISOString() };
}

// ───────────────────────────────────────── «لخّصلي» ─────────────────────────────────────────

/**
 * «لخّصلي» inside a topic: the last 40 messages of THAT topic, for a person who may read it. The answer goes back to the person only
 * (nothing is posted to the conversation, nothing is kept). A topic with a guest among its people is refused.
 */
export async function summarizeTopic(actor: Actor, conversationId: string, now: Date = new Date()): Promise<DigestAnswer> {
  await assertOffered(actor);
  const org = await loadOrgFacts(actor.userId, actor.orgId);
  const facts = await loadConversationFacts(actor.userId, conversationId);
  // a topic the person cannot read does not exist for them; a private chat or the assistant's own conversation is not summarised
  if (!org || org.status !== "ACTIVE" || org.role === "GUEST" || !facts || facts.orgId !== actor.orgId || facts.kind !== "TOPIC" || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { dmKey: true } });
  if (!conv || conv.dmKey !== null) throw new NotFoundError("chat.e.not_found");
  if (await conversationHasGuest(facts, conversationId, actor.orgId)) throw fail("guest");

  const p = await prepare(actor, now);
  const window = await db.chatMessage.findMany({
    where: { conversationId, deletedAt: null, kind: "TEXT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TOPIC_SUMMARY_MESSAGES,
    select: { id: true, authorId: true, body: true, author: { select: { name: true } } },
  });
  if (window.length === 0) return { text: "", empty: true, cached: false, generatedAt: null };
  const rows: ChatRow[] = window.reverse().map((m) => ({ id: m.id, authorId: m.authorId, authorName: m.author.name, body: m.body }));
  const prompt = buildChatPrompt(rows, {
    allowNames: p.allowNames,
    askingMessageId: "",
    companyNames: p.names,
    ...(p.choice.relax ? { relax: true } : {}),
    windowMessages: p.local ? LOCAL_WINDOW.messages : TOPIC_SUMMARY_MESSAGES,
    windowChars: p.local ? LOCAL_WINDOW.chars : TOPIC_SUMMARY_WINDOW_CHARS,
  });
  const content = `<chat>\n${chatLinesOf(prompt.content)}\n</chat>`;
  const answer = await ask(p, TOPIC_SUMMARY_SYSTEM_PROMPT, content, "topic");
  await record(
    actor,
    p,
    { action: "digest.topic_summarized", target: conversationId, conversationId, workspaceId: facts.spaceId, meta: { messages: prompt.messages, charsSent: content.length, charsReply: answer.text.length, masked: prompt.maskedTotal } },
    answer,
    null,
  );
  return { text: answer.text, empty: false, cached: false, generatedAt: now.toISOString() };
}
