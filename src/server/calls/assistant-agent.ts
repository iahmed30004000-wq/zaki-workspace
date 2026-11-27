import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { makeProvider } from "@/server/ai/registry";
import { redactText } from "@/server/ai/redact";
import { AiProviderError, type AiChatMessage, type AiCompletion } from "@/server/ai/provider";
import { meetingModelEnv } from "@/server/services/meeting-model-env";
import { LOCAL_MAX_OUTPUT_TOKENS } from "@/server/ai/local-transport";
import { dayKeyOf } from "@/lib/owner-board";
import { log } from "@/server/log";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { emitRealtime } from "@/server/realtime/emit";
import { moveLastMessageAt, systemMessage } from "@/server/chat/system";
import { ASSISTANT_BODY_PREFIX, conversationHasGuest } from "@/server/services/chat-assistant";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { assertWithinQuota, getSettings, recordUsage, usageSummary } from "@/server/services/owner-assistant-settings";
import { resolveProvider, runsOnOwnServer } from "@/server/services/assistant-provider";
import { ASSISTANT_IDENTITY, assistantPass, callsServer, peopleInRoom, requireCallsServer, roomOf } from "./livekit";
import { agentSettings, signBody, type AgentSettings } from "./agent-link";

// the shared secret and the signature live in ./agent-link (voice notes use them too); the old names are still given from here
export { agentSettings, signBody, verifySignature, SIGNATURE_MAX_AGE_SECONDS, type AgentSettings } from "./agent-link";

/**
 * «المساعد بالاجتماعات» — the owner's assistant speaks in a call.
 *
 *   WHO     only the OWNER, only in a call he may join, only while «مساعد المالك» and the switch «المساعد بالاجتماعات» are on.
 *   HOW     this server never touches the sound. A small program of the owner's own (the «voice agent», voice-agent/ in the repository, running
 *           on HIS server beside the calls server) joins the room as «المساعد»: it listens (speech to text), asks THIS server what to answer
 *           (`assistantTurn`, the owner's own provider), and speaks the answer (text to speech). Free software only; nothing is sent to a paid API.
 *   TRUST   the agent and this server speak with a shared secret: every request carries an HMAC of its body and time (`signedBody`), checked in
 *           constant time, valid for one minute.
 *   WHAT IT KNOWS  the words said in the meeting (filtered like the chat assistant: phones, e-mails, links, secrets masked), the call's title,
 *           and nothing else: no tasks, no customers, no messages. It answers only when somebody addresses it.
 *   TEXT    an answer that is spoken is ALSO written as a line of the call's conversation (the same «المساعد» line as in the chat; none for a meeting
 *           by link, a closed conversation or one with a guest in it). Silence («[صمت]») is neither spoken nor written.
 *   TRACE   one audit row per answer: counts only, never the words.
 */

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;

/** Test hook: answer the voice agent without one. */
export function setAgentFetchForTests(next: Fetch | null): void {
  fetchImpl = next;
}

async function tellAgent(settings: AgentSettings, path: "/join" | "/leave" | "/transcript", payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  let res: Response;
  try {
    res = await (fetchImpl ?? fetch)(`${settings.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-timestamp": String(ts), "x-agent-signature": signBody(settings.secret, ts, body) },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    log.warn("assistant_agent.unreachable", { path, message: err instanceof Error ? err.message : String(err) });
    throw new ForbiddenError("calls.e.assistant_unreachable");
  }
  if (!res.ok) {
    log.warn("assistant_agent.refused", { path, status: res.status });
    throw new ForbiddenError("calls.e.assistant_unreachable");
  }
}

/** «تسجيل نص الاجتماعات» (S6.2): tell the agent in the room to start or stop sending its finished sentences to the signed door (the owner's switch of ONE call). */
export async function tellAgentTranscript(callId: string, on: boolean): Promise<void> {
  const agent = agentSettings();
  if (!agent) throw new ForbiddenError("calls.e.assistant_not_configured");
  await tellAgent(agent, "/transcript", { callId, on });
}

export async function assertOwnerOfOpenCall(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "calls");
  await assertFeatureOn(ctx.orgId, "ownerAssistant");
  await assertFeatureOn(ctx.orgId, "assistantInMeetings");
  // the owner only: anybody else gets a plain «not found»
  if (ctx.orgRole !== "OWNER") throw new NotFoundError("features.off");
  const call = await db.call.findUnique({ where: { id: callId }, select: { orgId: true, endedAt: true } });
  if (!call || call.orgId !== ctx.orgId) throw new NotFoundError("calls.e.not_found");
  if (call.endedAt) throw new ForbiddenError("calls.e.ended");
}

/** What the call screen needs: may the viewer call the assistant, and is it in the room now? */
export async function assistantState(ctx: OrgAccessContext, inRoom: { identity: string }[]): Promise<{ available: boolean; present: boolean }> {
  if (ctx.orgRole !== "OWNER") return { available: false, present: false };
  const on = (await isFeatureOn(ctx.orgId, "assistantInMeetings")) && (await isFeatureOn(ctx.orgId, "ownerAssistant"));
  if (!on) return { available: false, present: false };
  return { available: agentSettings() !== null, present: inRoom.some((p) => p.identity === ASSISTANT_IDENTITY) };
}

/** «ادعُ المساعد»: the agent joins this call's room. */
export async function inviteAssistant(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertOwnerOfOpenCall(ctx, callId);
  const agent = agentSettings();
  if (!agent) throw new ForbiddenError("calls.e.assistant_not_configured");
  const server = requireCallsServer();
  const here = await peopleInRoom(callId);
  if (here?.some((p) => p.identity === ASSISTANT_IDENTITY)) return;
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, select: { title: true, transcribe: true, conversation: { select: { title: true } } } });
  await tellAgent(agent, "/join", {
    callId,
    room: roomOf(callId),
    url: server.url,
    token: await assistantPass(server, callId),
    title: call.title ?? call.conversation?.title ?? null,
    // S6.2: the owner turned the TEXT record on for this call (the agent sends its finished sentences to the signed door only while this is true)
    transcript: call.transcribe && (await isFeatureOn(ctx.orgId, "meetingMinutes")),
  });
  await db.auditLog.create({ data: { action: "assistant.meeting_join", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
}

/** «أخرج المساعد». */
export async function dismissAssistant(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertOwnerOfOpenCall(ctx, callId);
  const agent = agentSettings();
  if (!agent) throw new ForbiddenError("calls.e.assistant_not_configured");
  await tellAgent(agent, "/leave", { callId });
  // S6.2: with the assistant gone nobody writes the words: the record of this call is off (the mark must never say «عم يتسجّل» for nothing)
  await db.call.updateMany({ where: { id: callId, transcribe: true }, data: { transcribe: false } });
  await db.auditLog.create({ data: { action: "assistant.meeting_leave", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
}

// ---------- the answer ----------

export const MEETING_SYSTEM_PROMPT = [
  "أنت «المساعد»، عضو بالاجتماع بصوتك. المالك دعاك للمكالمة.",
  "احكِ باللهجة الشامية البسيطة الواضحة، متل ما بيحكي الناس بالاجتماع، بجمل قصيرة: جملة إلى ثلاث جمل على الأكثر. هالكلام بينقرأ بصوت عالي، فلا تستعمل رموز ولا قوائم ولا أي تنسيق، وكل الأرقام تُكتب بالحروف.",
  "ما بتعرف من الشغل إلا اللي انقال بالاجتماع نفسه. لا تخترع أرقام ولا أسماء ولا مهام. إذا ما بتعرف قول ما بعرف.",
  "ما بتنفّذ شي ولا بتوعد بتنفيذ شي. إذا طلبوا منك عمل بالنظام قول إنك بتسجّله كملاحظة وإنه الشخص ينفّذه بنفسه.",
  "إذا الكلام مش موجّه إلك، أو ما فهمت شو انقال، أو ما عندك شي مفيد تضيفه، ردّ بكلمة وحدة بالضبط: [صمت]",
].join("\n");

/** The model's word for «I have nothing to say». It is never spoken and never written, even when the assistant was named. */
export const SILENCE = "[صمت]";

const turnSchema = z.object({
  callId: z.string().min(1).max(64),
  /** who spoke last (a display name; the agent knows it from the room) */
  speaker: z.string().max(80).default(""),
  text: z.string().min(1).max(1500),
  /** it was said TO the assistant (its name as a whole word, or a short follow-up of the person it has just answered: decided by the agent) */
  addressed: z.boolean().default(true),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1500) })).max(12).default([]),
});

export const turnLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });

export interface TurnResult {
  reply: string;
  silent: boolean;
}

/** The voice agent asks what to say. `rawBody` is the request exactly as signed. */
export async function assistantTurn(rawBody: string, now: Date = new Date()): Promise<TurnResult> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ValidationError([{ path: "body", message: "validation.failed" }]);
  }
  const parsed = turnSchema.safeParse(json);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: "validation.failed" })));
  const input = parsed.data;

  const call = await db.call.findUnique({ where: { id: input.callId }, select: { orgId: true, endedAt: true, title: true, conversationId: true, conversation: { select: { title: true } } } });
  if (!call || call.endedAt) throw new NotFoundError("calls.e.not_found");
  await assertFeatureOn(call.orgId, "assistantInMeetings");
  await assertFeatureOn(call.orgId, "ownerAssistant");

  const limitKey = `assistantturn.${input.callId}`;
  if (!turnLimiter.check(limitKey).ok) throw new AssistantError("siteguide.rate_limited", "rate_limited");
  turnLimiter.hit(limitKey);

  const settings = await getSettings(call.orgId);
  const choice = await resolveProvider(call.orgId, settings, "owner");
  // a fast model of the owner's own for meetings (server variables, meeting-model-env.ts); the chosen one stays the fallback
  const fast = meetingModelEnv();
  if (!choice && !fast) throw new AssistantError(settings.ownerProvider === "claude" ? "assistant.no_key" : "assistant.no_local", "conflict");
  assertWithinQuota(await usageSummary(call.orgId, settings, now));
  const small = choice ? runsOnOwnServer(choice) : false;

  const clean = (text: string): string => redactText(text.replace(/[\x00-\x1f\x7f]+/g, " ").trim()).text;
  const history: AiChatMessage[] = input.history.map((t) => ({ role: t.role, content: clean(t.text) }));
  while (history.length > 0 && history[0]?.role !== "user") history.shift();
  const where = call.title ?? call.conversation?.title;
  const heard = `${where ? `عنوان الاجتماع: ${clean(where)}\n` : ""}${input.addressed ? "موجّه إليك" : "مش موجّه إليك"}${input.speaker ? ` · ${clean(input.speaker)}` : ""}:\n${clean(input.text)}`;
  const messages: AiChatMessage[] = [...history, { role: "user", content: heard }];
  let completion: AiCompletion | null = null;
  let usedFast = false;
  let model = choice?.model ?? "";
  if (fast) {
    try {
      // 512, not 220: a «thinking» model (gpt-oss) spends the allowance on its own reasoning and answers with nothing if it is too small
      const answer = await makeProvider({ kind: "openai", apiKey: fast.key, model: fast.model, baseUrl: fast.origin, external: true, chatPath: fast.path, fast: true }).complete({
        system: MEETING_SYSTEM_PROMPT,
        messages,
        tools: [],
        maxTokens: 512,
      });
      if (answer.text.trim() === "") {
        log.warn("assistant_meeting.fast_failed", { reason: "empty_answer" });
      } else {
        completion = answer;
        usedFast = true;
        model = fast.model;
      }
    } catch (err) {
      // the reason only (a key), never the text: then the chosen model answers instead
      log.warn("assistant_meeting.fast_failed", { reason: err instanceof AiProviderError ? err.key : "unknown" });
    }
  }
  if (!completion) {
    if (!choice) throw new AssistantError(settings.ownerProvider === "claude" ? "assistant.no_key" : "assistant.no_local", "conflict");
    model = choice.model;
    completion = await makeProvider(choice.config).complete({
      system: MEETING_SYSTEM_PROMPT,
      messages,
      tools: [],
      // a spoken answer is short: a long one is a minute of a machine talking
      maxTokens: small ? Math.min(220, LOCAL_MAX_OUTPUT_TOKENS) : 220,
    });
  }
  const reply = completion.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f*#_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
  // «[صمت]» (or nothing) is silence, whoever spoke: an addressed silence is NOT answered (the old «please repeat» sentence broke into side talk)
  const silent = reply === "" || reply.includes(SILENCE);
  // the cost is the owner's: it is his assistant, his key
  const owner = await db.organizationMember.findFirst({ where: { organizationId: call.orgId, role: "OWNER", status: "ACTIVE" }, select: { userId: true }, orderBy: { createdAt: "asc" } });
  if (owner) await recordUsage({ orgId: call.orgId, userId: owner.userId }, dayKeyOf(now, await orgTimeZone(call.orgId)), completion.usage);
  // the same words as a text line of the call's conversation (a meeting by link has none: skipped silently); a failure here never costs the spoken answer
  const posted =
    !silent && input.addressed && owner
      ? await postCallLine({ orgId: call.orgId, conversationId: call.conversationId, authorId: owner.userId, text: reply, local: !usedFast && small }).catch((err: unknown) => {
          // the name of the error only: never the words
          log.warn("assistant_meeting.line_failed", { name: err instanceof Error ? err.name : "unknown" });
          return false;
        })
      : false;
  await db.auditLog.create({
    data: { action: "assistant.meeting_turn", actorId: null, orgId: call.orgId, target: input.callId, meta: { heard: input.text.length, said: silent ? 0 : reply.length, addressed: input.addressed, model, posted } },
  });
  return { reply: silent ? "" : reply, silent };
}

/**
 * The assistant's answer as a line of the call's conversation: the SAME row «@المساعد» writes (`kind` SYSTEM, `{k:"assistant", p:{text}}`, authored by the
 * owner's row because a row needs an author, drawn as «المساعد»), so it follows the conversation's own visibility. No new table.
 * Nothing is written for a call with no conversation (a meeting by link), a closed or archived conversation, or one that has a guest among its people:
 * the voice stays in the room, but a text line would stay in a history a guest can read. Returns whether a line was written.
 */
export async function postCallLine(input: { orgId: string; conversationId: string | null; authorId: string; text: string; local: boolean; /** ids of `AiProposal` rows drawn as cards under the line (S6.2: the minutes' proposed tasks) */ props?: readonly string[] }): Promise<boolean> {
  if (!input.conversationId) return false;
  const conv = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, orgId: true, kind: true, spaceId: true, restricted: true, closedAt: true, archivedAt: true },
  });
  if (!conv || conv.orgId !== input.orgId || conv.closedAt || conv.archivedAt) return false;
  const kind = conv.kind === "TOPIC" ? "TOPIC" : conv.kind === "DM" ? "DM" : "GROUP";
  if (await conversationHasGuest({ kind, spaceId: conv.spaceId, restricted: conv.restricted }, conv.id, input.orgId)) return false;
  const first = (await db.chatMessage.count({ where: { conversationId: conv.id, kind: "SYSTEM", body: { startsWith: ASSISTANT_BODY_PREFIX } } })) === 0;
  const p: Record<string, string | number> = { text: input.text };
  if (first) p["first"] = 1;
  if (input.local) p["local"] = 1;
  if (input.props && input.props.length > 0) p["props"] = input.props.join(",");
  await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({
      data: { orgId: input.orgId, conversationId: conv.id, authorId: input.authorId, body: systemMessage("assistant", p), kind: "SYSTEM", clientId: `assistant:call:${randomUUID()}` },
      select: { id: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    await moveLastMessageAt(tx, conv.id, msg.createdAt);
    await emitRealtime(tx, input.orgId, "message.created", { conversationId: conv.id, messageId: msg.id, ...(conv.spaceId ? { spaceId: conv.spaceId } : {}) });
  });
  return true;
}

