import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { makeProvider } from "@/server/ai/registry";
import { redactText } from "@/server/ai/redact";
import type { AiChatMessage } from "@/server/ai/provider";
import { LOCAL_MAX_OUTPUT_TOKENS } from "@/server/ai/local-transport";
import { dayKeyOf } from "@/lib/owner-board";
import { hmacHex, safeEqual } from "@/server/crypto";
import { log } from "@/server/log";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { assertWithinQuota, getSettings, recordUsage, usageSummary } from "@/server/services/owner-assistant-settings";
import { resolveProvider, runsOnOwnServer } from "@/server/services/assistant-provider";
import { ASSISTANT_IDENTITY, assistantPass, callsServer, peopleInRoom, requireCallsServer, roomOf } from "./livekit";

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
 *   TRACE   one audit row per answer: counts only, never the words.
 */

export interface AgentSettings {
  url: string;
  secret: string;
}

/** Where the voice agent listens and its shared secret, or null while Coolify has none (the button says so). */
export function agentSettings(source: Record<string, string | undefined> = process.env): AgentSettings | null {
  const url = (source["VOICE_AGENT_URL"] ?? "").trim().replace(/\/+$/, "");
  const secret = (source["VOICE_AGENT_SECRET"] ?? "").trim();
  if (!url || secret.length < 16 || !/^https?:\/\//.test(url)) return null;
  return { url, secret };
}

/** A request's signature: HMAC-SHA256 over `<unix seconds>.<body>`. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return hmacHex(secret, `${timestamp}.${body}`);
}

export const SIGNATURE_MAX_AGE_SECONDS = 60;

/** Does this request come from the voice agent? Constant-time, and refuses an old or future timestamp. */
export function verifySignature(secret: string, timestampHeader: string | null, signatureHeader: string | null, body: string, nowMs: number = Date.now()): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d{9,12}$/.test(timestampHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) return false;
  return safeEqual(signBody(secret, ts, body), signatureHeader);
}

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;

/** Test hook: answer the voice agent without one. */
export function setAgentFetchForTests(next: Fetch | null): void {
  fetchImpl = next;
}

async function tellAgent(settings: AgentSettings, path: "/join" | "/leave", payload: Record<string, unknown>): Promise<void> {
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

async function assertOwnerOfOpenCall(ctx: OrgAccessContext, callId: string): Promise<void> {
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
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, select: { title: true, conversation: { select: { title: true } } } });
  await tellAgent(agent, "/join", {
    callId,
    room: roomOf(callId),
    url: server.url,
    token: await assistantPass(server, callId),
    title: call.title ?? call.conversation?.title ?? null,
  });
  await db.auditLog.create({ data: { action: "assistant.meeting_join", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
}

/** «أخرج المساعد». */
export async function dismissAssistant(ctx: OrgAccessContext, callId: string): Promise<void> {
  await assertOwnerOfOpenCall(ctx, callId);
  const agent = agentSettings();
  if (!agent) throw new ForbiddenError("calls.e.assistant_not_configured");
  await tellAgent(agent, "/leave", { callId });
  await db.auditLog.create({ data: { action: "assistant.meeting_leave", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
}

// ---------- the answer ----------

export const MEETING_SYSTEM_PROMPT = [
  "أنت «المساعد»، عضو بالاجتماع بصوتك. المالك دعاك للمكالمة.",
  "احكِ بالعربية الفصحى المبسّطة الواضحة، بجمل قصيرة: جملة إلى ثلاث جمل على الأكثر، بدون لهجة عامية. هالكلام بينقرأ بصوت عالي، فلا تستعمل رموز ولا قوائم ولا أي تنسيق، وكل الأرقام تُكتب بالحروف.",
  "ما بتعرف من الشغل إلا اللي انقال بالاجتماع نفسه. لا تخترع أرقام ولا أسماء ولا مهام. إذا ما بتعرف قول ما بعرف.",
  "ما بتنفّذ شي ولا بتوعد بتنفيذ شي. إذا طلبوا منك عمل بالنظام قول إنك بتسجّله كملاحظة وإنه الشخص ينفّذه بنفسه.",
  "إذا الكلام مش موجّه إلك وما عندك شي مفيد تضيفه، ردّ بكلمة وحدة بالضبط: [صمت]",
].join("\n");

export const SILENCE = "[صمت]";

const turnSchema = z.object({
  callId: z.string().min(1).max(64),
  /** who spoke last (a display name; the agent knows it from the room) */
  speaker: z.string().max(80).default(""),
  text: z.string().min(1).max(1500),
  /** it was said TO the assistant (its name, or the minute right after it spoke) */
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

  const call = await db.call.findUnique({ where: { id: input.callId }, select: { orgId: true, endedAt: true, title: true, conversation: { select: { title: true } } } });
  if (!call || call.endedAt) throw new NotFoundError("calls.e.not_found");
  await assertFeatureOn(call.orgId, "assistantInMeetings");
  await assertFeatureOn(call.orgId, "ownerAssistant");

  const limitKey = `assistantturn.${input.callId}`;
  if (!turnLimiter.check(limitKey).ok) throw new AssistantError("siteguide.rate_limited", "rate_limited");
  turnLimiter.hit(limitKey);

  const settings = await getSettings(call.orgId);
  const choice = await resolveProvider(call.orgId, settings, "owner");
  if (!choice) throw new AssistantError(settings.ownerProvider === "claude" ? "assistant.no_key" : "assistant.no_local", "conflict");
  assertWithinQuota(await usageSummary(call.orgId, settings, now));
  const small = runsOnOwnServer(choice);

  const clean = (text: string): string => redactText(text.replace(/[\x00-\x1f\x7f]+/g, " ").trim()).text;
  const history: AiChatMessage[] = input.history.map((t) => ({ role: t.role, content: clean(t.text) }));
  while (history.length > 0 && history[0]?.role !== "user") history.shift();
  const where = call.title ?? call.conversation?.title;
  const heard = `${where ? `عنوان الاجتماع: ${clean(where)}\n` : ""}${input.addressed ? "موجّه إليك" : "مش موجّه إليك"}${input.speaker ? ` · ${clean(input.speaker)}` : ""}:\n${clean(input.text)}`;
  const completion = await makeProvider(choice.config).complete({
    system: MEETING_SYSTEM_PROMPT,
    messages: [...history, { role: "user", content: heard }],
    tools: [],
    // a spoken answer is short: a long one is a minute of a machine talking
    maxTokens: small ? Math.min(220, LOCAL_MAX_OUTPUT_TOKENS) : 220,
  });
  const reply = completion.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f*#_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
  const silent = reply === "" || reply.includes(SILENCE) || (!input.addressed && reply.length === 0);
  // the cost is the owner's: it is his assistant, his key
  const owner = await db.organizationMember.findFirst({ where: { organizationId: call.orgId, role: "OWNER", status: "ACTIVE" }, select: { userId: true }, orderBy: { createdAt: "asc" } });
  if (owner) await recordUsage({ orgId: call.orgId, userId: owner.userId }, dayKeyOf(now, await orgTimeZone(call.orgId)), completion.usage);
  await db.auditLog.create({
    data: { action: "assistant.meeting_turn", actorId: null, orgId: call.orgId, target: input.callId, meta: { heard: input.text.length, said: silent ? 0 : reply.length, addressed: input.addressed, model: choice.model } },
  });
  return { reply: silent ? "" : reply, silent };
}

