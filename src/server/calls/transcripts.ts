import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { log } from "@/server/log";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { emitRealtime } from "@/server/realtime/emit";
import { canJoinCall, loadCallFacts } from "@/server/policy/call";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { agentSettings, assertOwnerOfOpenCall, inviteAssistant, tellAgentTranscript } from "./assistant-agent";
import { ASSISTANT_IDENTITY, peopleInRoom } from "./livekit";

/**
 * «تسجيل نص الاجتماعات» (S6.2) — THE WRITTEN LINES OF A CALL. TEXT ONLY: the owner decided «لا بس كتابة»; no audio is ever stored, uploaded or kept
 * anywhere, and nothing in this file or its table could hold any.
 *
 *   WHO TURNS IT ON   only the OWNER, for ONE call at a time (`Call.transcribe`), and only while the company's switches `meetingMinutes`,
 *                     `assistantInMeetings` and `ownerAssistant` are on. The voice agent is the only one that can write the words, so turning it on
 *                     invites the assistant into the room (or tells it, when it is already there); if the agent cannot be reached the record is left OFF.
 *   WHO SEES THE MARK everybody who can join the call: «عم يتسجّل النص» is drawn in the call room for all of them (`recordingState`).
 *   THE DOOR          `storeTranscriptLine`: the agent POSTs each finished sentence, signed exactly like /api/voice-agent/turn (a fresh time, an HMAC of
 *                     the body; here also a signature is accepted ONCE: a replay is refused). A line is stored only for a LIVE call with the record ON,
 *                     only for a person of that company, at most `TRANSCRIPT_LINE_MAX_CHARS` characters, at most 120 a minute per call.
 *   RETENTION         `purgeExpiredLines`: the lines older than the company's days (default 30, 1..365, `settings.meetingMinutes.retentionDays`) are
 *                     HARD-deleted by the job, even when the switch has been turned off since. A person who is deleted takes their lines with them.
 *   AFTER THE CALL    `queueMinutes` (the one hook in calls.ts) marks a call that had the record on «pending»; src/server/calls/minutes.ts builds the minutes.
 *   WHO READS         nobody reads a line from here: the minutes page (minutes.ts) shows the owner the full text and the host only the minutes.
 */

export const MINUTES_RETENTION_DEFAULT_DAYS = 30;
export const MINUTES_RETENTION_MIN_DAYS = 1;
export const MINUTES_RETENTION_MAX_DAYS = 365;
export const TRANSCRIPT_LINE_MAX_CHARS = 1500;

/** The company's days, from `Organization.settings`: a whole number from 1 to 365, otherwise 30 (a number over 365 is cut to 365). */
export function retentionDaysOf(settings: unknown): number {
  const raw = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>)["meetingMinutes"] : undefined;
  const days = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)["retentionDays"] : undefined;
  if (typeof days !== "number" || !Number.isInteger(days) || days < MINUTES_RETENTION_MIN_DAYS) return MINUTES_RETENTION_DEFAULT_DAYS;
  return Math.min(days, MINUTES_RETENTION_MAX_DAYS);
}

/** The settings with the retention days written next to everything else (nothing else is touched). */
export function withRetentionDays(settings: unknown, days: number): Record<string, unknown> {
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const mm = base["meetingMinutes"] && typeof base["meetingMinutes"] === "object" && !Array.isArray(base["meetingMinutes"]) ? (base["meetingMinutes"] as Record<string, unknown>) : {};
  return { ...base, meetingMinutes: { ...mm, retentionDays: days } };
}

/** The three switches the record needs, in this company. */
export async function minutesSwitchesOn(orgId: string): Promise<boolean> {
  return (await isFeatureOn(orgId, "meetingMinutes")) && (await isFeatureOn(orgId, "assistantInMeetings")) && (await isFeatureOn(orgId, "ownerAssistant"));
}

// ───────────────────────────────────────── the door ─────────────────────────────────────────

const bodySchema = z.object({
  callId: z.string().min(1).max(64),
  personId: z.string().min(1).max(64),
  text: z.string().max(TRANSCRIPT_LINE_MAX_CHARS).transform((t) => t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, " ").trim()).pipe(z.string().min(1)),
});

export interface TranscriptBody {
  callId: string;
  personId: string;
  text: string;
}

/** The door's body, exactly: a call, a person, a text. Any other field (an `audio` one, say) is dropped, never read. */
export function parseTranscriptBody(raw: string): TranscriptBody {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationError([{ path: "body", message: "validation.failed" }]);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: "validation.failed" })));
  return { callId: parsed.data.callId, personId: parsed.data.personId, text: parsed.data.text };
}

const REPLAY_TTL_MS = 120_000;
const seenSignatures = new Map<string, number>();

/** A signature is good once: true the first time (within two minutes), false for the same one again. The time check of `verifySignature` already refuses an old one. */
export function claimSignature(signature: string, nowMs: number = Date.now()): boolean {
  for (const [sig, until] of seenSignatures) if (until <= nowMs) seenSignatures.delete(sig);
  if (seenSignatures.has(signature)) return false;
  seenSignatures.set(signature, nowMs + REPLAY_TTL_MS);
  return true;
}

export const transcriptLimiter = new FixedWindowLimiter({ limit: 120, windowMs: 60_000 });

/**
 * One finished sentence from the voice agent. `rawBody` is the request exactly as signed (the route checked the signature). Never an error for «the record is
 * not on»: the agent is told `{ stored: false }` and stops sending for a while.
 */
export async function storeTranscriptLine(rawBody: string, now: Date = new Date()): Promise<{ stored: boolean }> {
  const body = parseTranscriptBody(rawBody);
  const call = await db.call.findUnique({ where: { id: body.callId }, select: { orgId: true, endedAt: true, transcribe: true } });
  if (!call || call.endedAt || !call.transcribe) return { stored: false };
  if (!(await minutesSwitchesOn(call.orgId))) return { stored: false };
  // the speaker must be a person of THIS company (a guest of the call included: it is their voice in the room)
  const member = await db.organizationMember.findFirst({ where: { organizationId: call.orgId, userId: body.personId }, select: { userId: true } });
  if (!member) return { stored: false };
  const key = `transcript.${body.callId}`;
  if (!transcriptLimiter.check(key).ok) throw new AssistantError("siteguide.rate_limited", "rate_limited");
  transcriptLimiter.hit(key);
  await db.callTranscriptLine.create({ data: { callId: body.callId, personId: body.personId, text: body.text, at: now } });
  return { stored: true };
}

// ───────────────────────────────────────── the mark and the switch of one call ─────────────────────────────────────────

export interface RecordingState {
  /** the text of this call is being written now (everybody in the call sees the mark) */
  on: boolean;
  /** the viewer may turn it on and off (the owner, with every switch on, the agent set up, the call still going) */
  canSet: boolean;
  /** how many days the written lines are kept */
  days: number;
}

async function orgDays(orgId: string): Promise<number> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return retentionDaysOf(org?.settings);
}

/** What the call room needs for the mark. Whoever may see the call; anybody else gets «not found». Never carries a word of the lines. */
export async function recordingState(ctx: OrgAccessContext, callId: string): Promise<RecordingState> {
  const loaded = await loadCallFacts(ctx.userId, callId);
  if (!loaded || loaded.facts.orgId !== ctx.orgId) throw new NotFoundError("calls.e.not_found");
  // an ended call still answers the people who could have been in it (its minutes page is theirs to ask for)
  if (!canJoinCall({ ...loaded.facts, endedAt: null }, loaded.org)) throw new NotFoundError("calls.e.not_found");
  const call = await db.call.findUnique({ where: { id: callId }, select: { transcribe: true, endedAt: true } });
  if (!call) throw new NotFoundError("calls.e.not_found");
  const switches = await minutesSwitchesOn(ctx.orgId);
  const live = !call.endedAt;
  return {
    on: switches && live && call.transcribe,
    canSet: switches && live && ctx.orgRole === "OWNER" && agentSettings() !== null,
    days: await orgDays(ctx.orgId),
  };
}

async function announce(orgId: string, callId: string): Promise<void> {
  const call = await db.call.findUnique({ where: { id: callId }, select: { conversationId: true } });
  if (call?.conversationId) await emitRealtime(db, orgId, "call.changed", { conversationId: call.conversationId, callId });
}

/**
 * The owner's two controls: «سجّل النص» / «وقّف» for this call, and the retention days (the company's). Anybody else: «not found». The audit lines carry the
 * call's id and the number of days, never a word.
 */
export async function setRecording(ctx: OrgAccessContext, callId: string, input: { on?: boolean; retentionDays?: number }): Promise<RecordingState> {
  await assertFeatureOn(ctx.orgId, "meetingMinutes");
  if (ctx.orgRole !== "OWNER") throw new NotFoundError("features.off");
  const call = await db.call.findUnique({ where: { id: callId }, select: { orgId: true } });
  if (!call || call.orgId !== ctx.orgId) throw new NotFoundError("calls.e.not_found");

  if (input.retentionDays !== undefined) {
    const days = input.retentionDays;
    await db.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
      await tx.organization.update({ where: { id: ctx.orgId }, data: { settings: withRetentionDays(org.settings, days) as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { action: "org.meeting_retention", actorId: ctx.userId, orgId: ctx.orgId, target: ctx.orgId, meta: { days } } });
    });
  }

  if (input.on === true) {
    await assertOwnerOfOpenCall(ctx, callId);
    await db.call.update({ where: { id: callId }, data: { transcribe: true } });
    try {
      const here = await peopleInRoom(callId);
      // the agent is the only one that can write the words: it is told, or it is invited with the flag
      if (here?.some((p) => p.identity === ASSISTANT_IDENTITY)) await tellAgentTranscript(callId, true);
      else await inviteAssistant(ctx, callId);
    } catch (err) {
      // a mark that records nothing would be a lie
      await db.call.update({ where: { id: callId }, data: { transcribe: false } });
      throw err;
    }
    await db.auditLog.create({ data: { action: "call.transcript_on", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
    await announce(ctx.orgId, callId);
  } else if (input.on === false) {
    const was = await db.call.updateMany({ where: { id: callId, transcribe: true }, data: { transcribe: false } });
    // the agent stops sending; if it cannot be reached it is the door that refuses (the flag is off now)
    await tellAgentTranscript(callId, false).catch(() => undefined);
    if (was.count > 0) await db.auditLog.create({ data: { action: "call.transcript_off", actorId: ctx.userId, orgId: ctx.orgId, target: callId, meta: {} } });
    await announce(ctx.orgId, callId);
  }
  return recordingState(ctx, callId);
}

// ───────────────────────────────────────── the end of a call, and the clean-up ─────────────────────────────────────────

/** THE HOOK of `finishCall` (calls.ts): a call that had the record on is queued for its minutes. Never throws: ending a call must not fail because of this. */
export async function queueMinutes(callId: string): Promise<void> {
  try {
    // the record is on, or it was on and stopped half way (the lines it wrote still deserve their minutes)
    await db.call.updateMany({ where: { id: callId, minutesState: null, OR: [{ transcribe: true }, { words: { some: {} } }] }, data: { minutesState: "pending" } });
  } catch (err) {
    log.warn("call_minutes.queue_failed", { name: err instanceof Error ? err.name : "unknown" });
  }
}

/** The lines older than each company's days are deleted (hard). Runs whatever the switch says: a line never outlives its days. */
export async function purgeExpiredLines(now: Date = new Date()): Promise<{ deleted: number }> {
  const orgs = await db.call.findMany({ where: { words: { some: {} } }, distinct: ["orgId"], select: { orgId: true } });
  let deleted = 0;
  for (const { orgId } of orgs) {
    const cutoff = new Date(now.getTime() - (await orgDays(orgId)) * 86_400_000);
    deleted += (await db.callTranscriptLine.deleteMany({ where: { at: { lt: cutoff }, call: { orgId } } })).count;
  }
  return { deleted };
}
