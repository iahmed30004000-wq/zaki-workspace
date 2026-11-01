import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { dayKeyOf } from "@/lib/owner-board";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import { log } from "@/server/log";
import { PROPOSE_TOOL } from "@/server/ai/actions";
import { LOCAL_CONTEXT_LIMITS, LOCAL_HISTORY, LOCAL_MAX_OUTPUT_TOKENS } from "@/server/ai/local-transport";
import { AssistantError } from "@/server/ai/api";
import { HISTORY_CHARS, HISTORY_TURNS, MAX_OUTPUT_TOKENS, QUESTION_MAX_CHARS, SYSTEM_PROMPT, composeUserMessage } from "@/server/ai/prompt";
import { makeProvider } from "@/server/ai/registry";
import {
  ContextLeakError,
  buildContext,
  capText,
  describeSent,
  labelOf,
  maskKnownNames,
  redactText,
  redactTextRelaxed,
  type KnownName,
  type MaskKind,
  type RefTable,
  type SentView,
} from "@/server/ai/redact";
import type { AiChatMessage } from "@/server/ai/provider";
import { orgTimeZone } from "@/server/services/org-day";
import type { AssistantAccess } from "@/server/services/owner-assistant-access";
import { loadScope } from "@/server/services/owner-assistant-data";
import { restorerFor } from "@/server/services/owner-assistant-names";
import { expireStale, prepareProposals, proposalViews, saveProposals, type ProposalView } from "@/server/services/owner-assistant-proposals";
import { isLocalKind, resolveProvider } from "@/server/services/assistant-provider";
import { assertWithinQuota, getSettings, recordUsage, usageSummary, type UsageSummary } from "@/server/services/owner-assistant-settings";
import type { BoardQuery } from "@/server/services/owner-board";

/**
 * «مساعد المالك» — THE CONVERSATION. One question in, one answer out; everything that reaches the model is built by
 * `buildContext` + `redactText` (src/server/ai/redact.ts) and nothing else.
 *
 * The order of one question, and why:
 *   1. access (owner only, switch on) and the settings, the key and the quotas are read BEFORE anything is built;
 *   2. the context is built from the board's aggregates (names → «موظف n» unless allowed; titles only when allowed, redacted);
 *   3. the owner's question is redacted the same way (numbers, addresses, secrets masked; staff and space names replaced);
 *   4. the provider is called with a fixed system prompt, at most `MAX_OUTPUT_TOKENS` back, one tool: `propose_action`;
 *   5. only then is anything written: the question as sent, the answer with the pseudonyms (never real names), the exact request
 *      for «شو انبعت للنموذج», the proposals (PENDING: nothing runs), and the usage counters (no content).
 * A call that fails, or is refused, leaves nothing behind but what the owner already had.
 */

export const MESSAGE_ROLES = ["USER", "ASSISTANT"] as const;

const bodySchema = z
  .object({
    conversationId: z.string().trim().min(5).max(60).nullish(),
    message: z.string().trim().min(1, "assistant.message_invalid").max(QUESTION_MAX_CHARS, "assistant.message_invalid"),
    range: z.string().trim().max(64).nullish(),
    from: z.string().trim().max(64).nullish(),
    to: z.string().trim().max(64).nullish(),
    space: z.string().trim().max(64).nullish(),
  })
  .strict();

export type ChatInput = z.infer<typeof bodySchema>;

export function parseChatInput(body: unknown): ChatInput {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError([{ path: first?.path.join(".") || "body", message: first && first.message.startsWith("assistant.") ? first.message : "validation.failed" }]);
  }
  return parsed.data;
}

export interface MessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  /** The text for the owner's eyes: the pseudonyms replaced by the real names (never stored like this). */
  text: string;
  createdAt: string;
  /** «شو انبعت للنموذج»: the exact request, as readable JSON (answers only). */
  sent: string | null;
  proposals: ProposalView[];
}

export interface MaskReport {
  /** Pieces of the question that were masked, by kind. */
  masked: Record<MaskKind, number>;
  /** Staff / space names in the question replaced by labels. */
  names: number;
  /** Pieces of titles and names that were masked. */
  titles: number;
  total: number;
}

export interface ChatResult {
  conversationId: string;
  title: string;
  user: MessageView;
  answer: MessageView;
  report: MaskReport;
  usage: UsageSummary;
}

const refsOf = (value: Prisma.JsonValue | null | undefined): RefTable => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: RefTable = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
};

/** The request as it was written when the answer was stored (a text, so the order of its keys is exactly what the owner saw). */
const sentOf = (value: Prisma.JsonValue | null): string | null => (typeof value === "string" ? value : null);

/** The earlier turns of a conversation as they were sent: the newest that fit in `HISTORY_CHARS`, oldest first. */
function historyOf(rows: readonly { role: string; content: string }[], limits: { turns: number; chars: number } = { turns: HISTORY_TURNS, chars: HISTORY_CHARS }): AiChatMessage[] {
  const out: AiChatMessage[] = [];
  let size = 0;
  for (const row of [...rows].reverse().slice(0, limits.turns)) {
    size += row.content.length;
    if (size > limits.chars) break;
    out.unshift({ role: row.role === "ASSISTANT" ? "assistant" : "user", content: row.content });
  }
  // a conversation sent to the model must open with a user turn
  while (out.length > 0 && out[0]?.role !== "user") out.shift();
  return out;
}

/** The people, spaces and projects whose real names must not leave in the owner's question. */
function knownNames(raw: { people: { userId: string; name: string }[]; spaces: { id: string; name: string; projects: { id: string; name: string }[] }[] }, table: RefTable, hide: { staff: boolean; titles: boolean }): KnownName[] {
  const refOf = new Map(Object.entries(table).map(([ref, id]) => [id, ref]));
  const out: KnownName[] = [];
  if (hide.staff) {
    for (const p of raw.people) {
      const ref = refOf.get(p.userId);
      if (ref) out.push({ label: labelOf(ref), names: [p.name] });
    }
  }
  if (hide.titles) {
    for (const s of raw.spaces) {
      const ref = refOf.get(s.id);
      if (ref) out.push({ label: labelOf(ref), names: [s.name] });
      for (const p of s.projects) {
        const pref = refOf.get(p.id);
        if (pref) out.push({ label: labelOf(pref), names: [p.name] });
      }
    }
  }
  return out;
}

/** One question. Throws `AssistantError` for a refusal (no key, a quota), a `AiProviderError` when the provider failed. */
export async function sendMessage(access: AssistantAccess, body: unknown, now: Date = new Date()): Promise<ChatResult> {
  const input = parseChatInput(body);
  const { orgId, userId } = access;
  const settings = await getSettings(orgId);
  // which model answers: Claude (the owner's key), or a local one (src/server/services/assistant-provider.ts)
  const choice = await resolveProvider(orgId, settings, "owner");
  if (!choice) throw new AssistantError(settings.ownerProvider === "claude" ? "assistant.no_key" : "assistant.no_local", "conflict");
  const local = isLocalKind(choice.kind);
  const tz = await orgTimeZone(orgId);
  const day = dayKeyOf(now, tz);
  assertWithinQuota(await usageSummary(orgId, settings, now));

  const conversation = input.conversationId
    ? await db.aiConversation.findFirst({ where: { id: input.conversationId, orgId, userId }, select: { id: true, title: true, refs: true } })
    : null;
  if (input.conversationId && !conversation) throw new AssistantError("assistant.not_found", "not_found");
  const earlier = conversation
    ? await db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: HISTORY_TURNS + 2, select: { role: true, content: true } })
    : [];

  // 2. the context
  const query: BoardQuery = { preset: input.range ?? null, from: input.from ?? null, to: input.to ?? null, space: input.space ?? null };
  const raw = await loadScope(access.board, query, now);
  let built;
  try {
    // a small local model gets a smaller context (its window is 4096 tokens); the filter below it is the same
    built = buildContext(raw, { allowNames: settings.allowNames, allowTitles: settings.allowTitles, refs: refsOf(conversation?.refs), ...(local ? LOCAL_CONTEXT_LIMITS : {}) });
  } catch (err) {
    if (err instanceof ContextLeakError) {
      // fail closed: nothing is sent; only the place in the object is logged, never a value
      log.error("ai.context_blocked", { path: err.path });
      throw new AssistantError("assistant.context_blocked", "conflict");
    }
    throw err;
  }

  // 3. the question
  // the relaxed filter only for a local model and only with the owner's switch (`choice.relax`); the external model never gets it
  const redacted = choice.relax ? redactTextRelaxed(input.message) : redactText(input.message);
  const hidden = maskKnownNames(redacted.text, knownNames(raw, built.refs, { staff: !settings.allowNames, titles: !settings.allowTitles }));
  const question = hidden.text;

  // 4. the call
  const history = historyOf(earlier.map((m) => ({ role: m.role, content: m.content })).reverse(), local ? LOCAL_HISTORY : undefined);
  const maxTokens = local ? Math.min(MAX_OUTPUT_TOKENS, LOCAL_MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS;
  const messages: AiChatMessage[] = [...history, { role: "user", content: composeUserMessage(built.context, question) }];
  const view: SentView = {
    model: choice.model,
    maxTokens,
    system: SYSTEM_PROMPT,
    tools: [PROPOSE_TOOL.name],
    history,
    data: built.context,
    question,
  };
  const provider = makeProvider(choice.config);
  const completion = await provider.complete({ system: SYSTEM_PROMPT, messages, tools: [{ name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description, inputSchema: PROPOSE_TOOL.inputSchema as unknown as Record<string, unknown> }], maxTokens });

  // 5. what is kept
  const prepared = await prepareProposals(orgId, built.refs, completion.toolCalls);
  const sent = describeSent(view);
  const reply = completion.text || (prepared.items.length > 0 ? AR["assistant.reply_proposals"] ?? "" : AR["assistant.reply_empty"] ?? "");
  const title = capText(question.replace(/\s+/g, " "), 60);
  const saved = await db.$transaction(async (tx) => {
    const convId = conversation
      ? (await tx.aiConversation.update({ where: { id: conversation.id }, data: { refs: built.refs, updatedAt: now }, select: { id: true } })).id
      : (await tx.aiConversation.create({ data: { orgId, userId, title, refs: built.refs, createdAt: now, updatedAt: now }, select: { id: true } })).id;
    const userRow = await tx.aiMessage.create({ data: { conversationId: convId, role: "USER", content: question, createdAt: now } });
    const answerRow = await tx.aiMessage.create({ data: { conversationId: convId, role: "ASSISTANT", content: reply, sentJson: sent, createdAt: new Date(now.getTime() + 1) } });
    await saveProposals(tx, { orgId, conversationId: convId, messageId: answerRow.id }, prepared.items);
    return { convId, userRow, answerRow };
  });
  await recordUsage({ orgId, userId }, day, completion.usage);

  const proposalRows = await db.aiProposal.findMany({ where: { messageId: saved.answerRow.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: PROPOSAL_ROW });
  const restorer = await restorerFor(orgId, built.refs, [saved.answerRow.content]);
  const proposals = await proposalViews(orgId, proposalRows, built.refs);
  const report: MaskReport = { masked: redacted.masked, names: hidden.count, titles: built.masked, total: redacted.count + hidden.count + built.masked };
  return {
    conversationId: saved.convId,
    title: conversation?.title ?? title,
    user: { id: saved.userRow.id, role: "USER", text: question, createdAt: saved.userRow.createdAt.toISOString(), sent: null, proposals: [] },
    answer: { id: saved.answerRow.id, role: "ASSISTANT", text: restorer.restore(saved.answerRow.content), createdAt: saved.answerRow.createdAt.toISOString(), sent, proposals },
    report,
    usage: await usageSummary(orgId, settings, now),
  };
}

const PROPOSAL_ROW = { id: true, type: true, paramsJson: true, reasonText: true, status: true, createdAt: true, decidedAt: true, resultJson: true } as const;

// ───────────────────────────────────────── reading ─────────────────────────────────────────

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

/** The owner's own conversations, newest first (nobody else's, ever). */
export async function listConversations(access: AssistantAccess, limit = 30): Promise<ConversationItem[]> {
  const rows = await db.aiConversation.findMany({ where: { orgId: access.orgId, userId: access.userId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, select: { id: true, title: true, updatedAt: true, refs: true } });
  const out: ConversationItem[] = [];
  for (const r of rows) {
    const { restore } = await restorerFor(access.orgId, refsOf(r.refs), [r.title]);
    out.push({ id: r.id, title: restore(r.title), updatedAt: r.updatedAt.toISOString() });
  }
  return out;
}

export interface ConversationView {
  id: string;
  title: string;
  messages: MessageView[];
}

/** One conversation with its messages and its proposals (the stale ones are expired first). 404 for anybody else's. */
export async function getConversation(access: AssistantAccess, id: string, now: Date = new Date()): Promise<ConversationView> {
  const row = await db.aiConversation.findFirst({ where: { id, orgId: access.orgId, userId: access.userId }, select: { id: true, title: true, refs: true } });
  if (!row) throw new AssistantError("assistant.not_found", "not_found");
  await expireStale(now, access.orgId);
  const [messages, proposalRows] = await Promise.all([
    db.aiMessage.findMany({ where: { conversationId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, role: true, content: true, sentJson: true, createdAt: true } }),
    db.aiProposal.findMany({ where: { conversationId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { ...PROPOSAL_ROW, messageId: true } }),
  ]);
  const table = refsOf(row.refs);
  const restorer = await restorerFor(access.orgId, table, [row.title, ...messages.map((m) => m.content)]);
  const views = await proposalViews(access.orgId, proposalRows, table);
  const byMessage = new Map<string, ProposalView[]>();
  proposalRows.forEach((p, i) => {
    const list = byMessage.get(p.messageId) ?? [];
    list.push(views[i] as ProposalView);
    byMessage.set(p.messageId, list);
  });
  return {
    id: row.id,
    title: restorer.restore(row.title),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role === "ASSISTANT" ? "ASSISTANT" : "USER",
      text: restorer.restore(m.content),
      createdAt: m.createdAt.toISOString(),
      sent: m.role === "ASSISTANT" ? sentOf(m.sentJson) : null,
      proposals: byMessage.get(m.id) ?? [],
    })),
  };
}

/** «امسح المحادثة»: the conversation, its messages and its proposals are deleted (the audit rows of decisions stay). */
export async function deleteConversation(access: AssistantAccess, id: string): Promise<void> {
  const res = await db.aiConversation.deleteMany({ where: { id, orgId: access.orgId, userId: access.userId } });
  if (res.count === 0) throw new AssistantError("assistant.not_found", "not_found");
}

