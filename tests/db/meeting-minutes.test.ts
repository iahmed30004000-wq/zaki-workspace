import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as endRoute from "@/app/api/calls/[id]/end/route";
import * as minutesRoute from "@/app/api/calls/[id]/minutes/route";
import * as assistantRoute from "@/app/api/calls/[id]/assistant/route";
import * as doorRoute from "@/app/api/voice-agent/transcript/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { AiRequest } from "@/server/ai/provider";
import { AiProviderError } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { setAgentFetchForTests, signBody } from "@/server/calls/assistant-agent";
import { readMinutes, runPendingMinutes } from "@/server/calls/minutes";
import { purgeExpiredLines, transcriptLimiter } from "@/server/calls/transcripts";
import { runDueJobs } from "@/server/jobs/run";
import { call, db, loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";

/**
 * S6.2 «محضر الاجتماع» (TEXT ONLY) — against a real PostgreSQL, a fake calls server, a fake voice agent and a fake model.
 *
 * Pinned: only the owner turns the record on (and only while both switches are on); the door takes a line only with a fresh, new, correct signature, only for a
 * live call with the record on, and never audio; the mark's state is visible to the people of the call and to nobody else; the lines are deleted after the
 * company's days even with the switch off; the end of a call queues the minutes; the minutes are built from REDACTED text, posted into the call's conversation
 * (or the space's «عام» topic for a meeting by link, or only kept on the call), the tasks wait as proposal cards and nothing is created; a guest never reads a
 * transcript, and a conversation with a guest in it gets no minutes line.
 */

const KEY = "sk-ant-api03-MINUTES-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore
const LK_SECRET = "test-calls-secret-0123456789abcdef0123456789";
const AGENT_SECRET = "test-agent-secret-0123456789abcdef";
const saved: Record<string, string | undefined> = {};
const ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "VOICE_AGENT_URL", "VOICE_AGENT_SECRET"];

let rooms = new Map<string, string[]>();
let seen: AiRequest[] = [];
let modelSays = "";
let modelFails = false;
let agentCalls: { path: string; body: string }[] = [];

const GOOD_MINUTES = (who = "زميل 1") =>
  JSON.stringify({ summary: "ناقشنا موعد الإطلاق والميزانية.", decisions: ["نأجل الإطلاق أسبوع"], tasks: [{ title: "جهّز تقرير الميزانية", who }, { title: "ابعت العرض للزبون" }] });

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
  setAgentFetchForTests(null);
});
beforeEach(() => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = LK_SECRET;
  process.env["VOICE_AGENT_URL"] = "http://voice-agent:8080";
  process.env["VOICE_AGENT_SECRET"] = AGENT_SECRET;
  rooms = new Map();
  seen = [];
  modelSays = GOOD_MINUTES();
  modelFails = false;
  agentCalls = [];
  setCallsFetchForTests(async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { room: string };
    if (String(input).endsWith("/ListParticipants")) {
      if (!rooms.has(body.room)) return new Response("{}", { status: 404 });
      return Response.json({ participants: (rooms.get(body.room) ?? []).map((identity) => ({ identity, name: identity })) });
    }
    return Response.json({});
  });
  setAgentFetchForTests(async (input, init) => {
    agentCalls.push({ path: new URL(String(input)).pathname, body: String(init?.body) });
    return Response.json({ ok: true });
  });
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      if (modelFails) throw new AiProviderError("assistant.err_overloaded");
      return { text: modelSays, toolCalls: [], usage: { inputTokens: 80, outputTokens: 40 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { minutes?: boolean } = {}) {
  const t = await makeTeam();
  await setFeature(t.org.id, "ownerAssistant", true);
  await setFeature(t.org.id, "assistantInMeetings", true);
  if (opts.minutes !== false) await setFeature(t.org.id, "meetingMinutes", true);
  await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  await makeProject(ws.id, "مشروع");
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "اجتماع الأسبوع" } });
  const general = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "عام", systemKey: "general" } });
  return { ...t, ws, topic, general };
}

/** A live call of the topic, started by the member (so the member is its host). */
async function liveCall(w: Awaited<ReturnType<typeof world>>) {
  await loginAs(w.member.id);
  const started = await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: true } });
  expect(started.status, started.text).toBe(201);
  return started.json?.["id"] as string;
}

/** A call row made directly: ended, with the record on, as if the call ran. */
async function endedCall(w: Awaited<ReturnType<typeof world>>, opts: { conversationId?: string | null; spaceId?: string | null; minutesState?: string | null; transcribe?: boolean; endedAt?: Date } = {}) {
  return db.call.create({
    data: {
      orgId: w.org.id,
      spaceId: opts.spaceId === undefined ? w.ws.id : opts.spaceId,
      conversationId: opts.conversationId === undefined ? w.topic.id : opts.conversationId,
      title: "اجتماع",
      startedById: w.member.id,
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: opts.endedAt ?? new Date(Date.now() - 60_000),
      transcribe: opts.transcribe ?? true,
      minutesState: opts.minutesState === undefined ? "pending" : opts.minutesState,
    },
  });
}

async function addLines(callId: string, lines: { personId: string; text: string; at?: Date }[]) {
  let i = 0;
  for (const l of lines) await db.callTranscriptLine.create({ data: { callId, personId: l.personId, text: l.text, at: l.at ?? new Date(Date.now() - 600_000 + i++ * 1000) } });
}

const record = (callId: string, body: Record<string, unknown>) => call(minutesRoute.POST, { params: { id: callId }, body });
const state = (callId: string) => call(minutesRoute.GET, { params: { id: callId } });

/** What the voice agent sends to the door, signed the way it signs (`logic.sign`). */
async function door(body: Record<string, unknown>, opts: { secret?: string; ageSeconds?: number; req?: Request } = {}) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
  const req =
    opts.req ??
    new Request("http://localhost/api/voice-agent/transcript", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-timestamp": String(ts), "x-agent-signature": signBody(opts.secret ?? AGENT_SECRET, ts, raw) },
      body: raw,
    });
  const res = await doorRoute.POST(req);
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text || "null") as Record<string, unknown> | null, text, req };
}

describe("turning the record on", () => {
  it("only the OWNER may, and only while «تسجيل نص الاجتماعات» is on: everybody else gets «not found», nothing changes", async () => {
    const w = await world();
    const id = await liveCall(w);
    for (const who of [w.admin.id, w.member.id, w.guest.id]) {
      await loginAs(who);
      expect((await record(id, { on: true })).status).toBeGreaterThanOrEqual(403);
    }
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(false);
    await setFeature(w.org.id, "meetingMinutes", false);
    await loginAs(w.owner.id);
    expect((await record(id, { on: true })).status).toBe(404);
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(false);
  });

  it("the owner turns it on: the flag is set, an audit line is written (counters only), the assistant is invited with the flag, everybody sees the mark", async () => {
    const w = await world();
    const id = await liveCall(w);
    await loginAs(w.owner.id);
    const on = await record(id, { on: true });
    expect(on.status, on.text).toBe(200);
    expect(on.json).toMatchObject({ on: true, canSet: true, days: 30 });
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(true);
    const join = agentCalls.find((a) => a.path === "/join");
    expect(join, "the agent is the only one who can write the words: it is invited").toBeTruthy();
    expect(JSON.parse(join!.body)).toMatchObject({ callId: id, transcript: true });
    const audit = await db.auditLog.findFirst({ where: { action: "call.transcript_on", target: id } });
    expect(audit?.actorId).toBe(w.owner.id);
    expect(JSON.stringify(audit?.meta)).not.toMatch(/اجتماع/);
    // the member (in the call's conversation) sees the mark; he cannot change it
    await loginAs(w.member.id);
    const seenByMember = await state(id);
    expect(seenByMember.status).toBe(200);
    expect(seenByMember.json?.["recording"]).toMatchObject({ on: true, canSet: false, days: 30 });
    // a guest who is not in the space does not even know the call
    await loginAs(w.guest.id);
    expect((await state(id)).status).toBe(404);
  });

  it("with the assistant already in the room the agent is told (signed) instead of invited again; off tells it too and clears the flag", async () => {
    const w = await world();
    const id = await liveCall(w);
    rooms.set(`zk-${id}`, [w.member.id, "assistant"]);
    await loginAs(w.owner.id);
    expect((await record(id, { on: true })).status).toBe(200);
    expect(agentCalls.map((a) => a.path)).toEqual(["/transcript"]);
    expect(JSON.parse(agentCalls[0]!.body)).toEqual({ callId: id, on: true });
    expect((await record(id, { on: false })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(false);
    expect(agentCalls.map((a) => a.path)).toEqual(["/transcript", "/transcript"]);
    expect(JSON.parse(agentCalls[1]!.body)).toEqual({ callId: id, on: false });
  });

  it("if the agent cannot be reached the record is NOT left on (a mark that records nothing would be a lie)", async () => {
    const w = await world();
    const id = await liveCall(w);
    setAgentFetchForTests(async () => new Response("no", { status: 500 }));
    await loginAs(w.owner.id);
    expect((await record(id, { on: true })).status).toBeGreaterThanOrEqual(400);
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(false);
  });

  it("sending the assistant out turns the record off", async () => {
    const w = await world();
    const id = await liveCall(w);
    rooms.set(`zk-${id}`, [w.member.id, "assistant"]);
    await loginAs(w.owner.id);
    await record(id, { on: true });
    expect((await call(assistantRoute.POST, { params: { id }, body: { on: false } })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id } })).transcribe).toBe(false);
  });

  it("the retention days are the owner's: 1..365, kept in the company's settings, with an audit line", async () => {
    const w = await world();
    const id = await liveCall(w);
    await loginAs(w.owner.id);
    expect((await record(id, { retentionDays: 0 })).status).toBe(422);
    expect((await record(id, { retentionDays: 400 })).status).toBe(422);
    const set = await record(id, { retentionDays: 14 });
    expect(set.status, set.text).toBe(200);
    expect(set.json).toMatchObject({ days: 14, on: false });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect((org.settings as { meetingMinutes?: { retentionDays?: number } }).meetingMinutes?.retentionDays).toBe(14);
    expect((org.settings as { features?: Record<string, boolean> }).features?.["meetingMinutes"]).toBe(true);
    expect(await db.auditLog.count({ where: { action: "org.meeting_retention", orgId: w.org.id } })).toBe(1);
    await loginAs(w.admin.id);
    expect((await record(id, { retentionDays: 3 })).status).toBeGreaterThanOrEqual(403);
  });
});

describe("the signed door", () => {
  async function recording() {
    const w = await world();
    const id = await liveCall(w);
    await db.call.update({ where: { id }, data: { transcribe: true } });
    transcriptLimiter.reset(`transcript.${id}`);
    return { w, id };
  }
  // a different text every time: the same words in the same second would be the SAME signed request (a replay)
  let n = 0;
  const lineOf = (id: string, personId: string, text = "اتفقنا ننهي التقرير بكرا") => ({ callId: id, personId, text: text === "اتفقنا ننهي التقرير بكرا" ? `${text} ${++n}` : text });

  it("stores a finished sentence with who said it, while the call is live and the record is on", async () => {
    const { w, id } = await recording();
    const r = await door(lineOf(id, w.member.id));
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ stored: true });
    const rows = await db.callTranscriptLine.findMany({ where: { callId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: w.member.id });
    expect(rows[0]?.text).toContain("اتفقنا ننهي التقرير بكرا");
  });

  it("refuses anything unsigned, signed with another secret, stale, or replayed: a plain «not found», nothing stored", async () => {
    const { w, id } = await recording();
    const body = lineOf(id, w.member.id);
    expect((await door(body, { secret: "another-secret-0123456789abcdef" })).status).toBe(404);
    expect((await door(body, { ageSeconds: 120 })).status).toBe(404);
    const unsigned = await doorRoute.POST(new Request("http://localhost/api/voice-agent/transcript", { method: "POST", body: JSON.stringify(body) }));
    expect(unsigned.status).toBe(404);
    const first = await door(body);
    expect(first.status).toBe(200);
    // the very same request again (same time, same signature) is a replay
    const again = await doorRoute.POST(
      new Request("http://localhost/api/voice-agent/transcript", { method: "POST", headers: { "content-type": "application/json", "x-agent-timestamp": first.req.headers.get("x-agent-timestamp")!, "x-agent-signature": first.req.headers.get("x-agent-signature")! }, body: JSON.stringify(body) }),
    );
    expect(again.status).toBe(404);
    expect(await db.callTranscriptLine.count({ where: { callId: id } })).toBe(1);
  });

  it("with no agent secret on the server the door does not exist", async () => {
    const { w, id } = await recording();
    delete process.env["VOICE_AGENT_SECRET"];
    expect((await door(lineOf(id, w.member.id))).status).toBe(404);
  });

  it("stores nothing when the record is off for the call, the switch is off, the call has ended, or the assistant switches are off — and says so without an error", async () => {
    const { w, id } = await recording();
    await db.call.update({ where: { id }, data: { transcribe: false } });
    expect((await door(lineOf(id, w.member.id))).json).toEqual({ stored: false });
    await db.call.update({ where: { id }, data: { transcribe: true } });
    await setFeature(w.org.id, "meetingMinutes", false);
    expect((await door(lineOf(id, w.member.id))).json).toEqual({ stored: false });
    await setFeature(w.org.id, "meetingMinutes", true);
    await setFeature(w.org.id, "assistantInMeetings", false);
    expect((await door(lineOf(id, w.member.id))).json).toEqual({ stored: false });
    await setFeature(w.org.id, "assistantInMeetings", true);
    await db.call.update({ where: { id }, data: { endedAt: new Date() } });
    expect((await door(lineOf(id, w.member.id))).json).toEqual({ stored: false });
    expect(await db.callTranscriptLine.count({ where: { callId: id } })).toBe(0);
  });

  it("a person who is not of this company, or a call of another company, stores nothing", async () => {
    const { w, id } = await recording();
    const other = await makeTeam();
    expect((await door(lineOf(id, other.member.id))).json).toEqual({ stored: false });
    expect((await door(lineOf("no-such-call", w.member.id))).json).toEqual({ stored: false });
    expect(await db.callTranscriptLine.count({ where: { callId: id } })).toBe(0);
  });

  it("refuses a text over the cap and an empty one (422), and is rate limited per call (429)", async () => {
    const { w, id } = await recording();
    expect((await door(lineOf(id, w.member.id, "ا".repeat(1501)))).status).toBe(422);
    expect((await door(lineOf(id, w.member.id, "  "))).status).toBe(422);
    let last = 200;
    for (let i = 0; i < 130 && last === 200; i++) last = (await door(lineOf(id, w.member.id, `جملة ${i}`))).status;
    expect(last).toBe(429);
  });
});

describe("the mark's state", () => {
  it("is false for a call nobody turned the record on for, and never carries a word of the lines", async () => {
    const w = await world();
    const id = await liveCall(w);
    await addLines(id, [{ personId: w.member.id, text: "كلام سرّي جدًا" }]);
    await loginAs(w.member.id);
    const r = await state(id);
    expect(r.json?.["recording"]).toMatchObject({ on: false, canSet: false });
    expect(r.text).not.toContain("سرّي");
    await loginAs(w.owner.id);
    const owner = await state(id);
    expect(owner.json?.["recording"]).toMatchObject({ on: false, canSet: true });
    expect(owner.text).not.toContain("سرّي");
  });

  it("with the switch off nobody can set it and nobody sees it on", async () => {
    const w = await world({ minutes: false });
    const id = await liveCall(w);
    await db.call.update({ where: { id }, data: { transcribe: true } });
    await loginAs(w.member.id);
    expect((await state(id)).json?.["recording"]).toMatchObject({ on: false, canSet: false });
    await loginAs(w.owner.id);
    expect((await state(id)).json?.["recording"]).toMatchObject({ on: false, canSet: false });
  });
});

describe("the retention job", () => {
  it("deletes the lines older than the company's days (default 30) and keeps the newer ones, even with the switch OFF", async () => {
    const w = await world({ minutes: false });
    const c = await endedCall(w, { minutesState: null });
    const day = 86_400_000;
    await addLines(c.id, [
      { personId: w.member.id, text: "قديم", at: new Date(Date.now() - 31 * day) },
      { personId: w.member.id, text: "جديد", at: new Date(Date.now() - 29 * day) },
    ]);
    const r = await purgeExpiredLines(new Date());
    expect(r.deleted).toBe(1);
    expect((await db.callTranscriptLine.findMany({ where: { callId: c.id } })).map((l) => l.text)).toEqual(["جديد"]);
  });

  it("uses each company's own days", async () => {
    const a = await world();
    const b = await world();
    await db.organization.update({ where: { id: a.org.id }, data: { settings: { features: {}, meetingMinutes: { retentionDays: 3 } } } });
    const ca = await endedCall(a, { minutesState: null });
    const cb = await endedCall(b, { minutesState: null });
    const at = new Date(Date.now() - 5 * 86_400_000);
    await addLines(ca.id, [{ personId: a.member.id, text: "أ", at }]);
    await addLines(cb.id, [{ personId: b.member.id, text: "ب", at }]);
    await purgeExpiredLines(new Date());
    expect(await db.callTranscriptLine.count({ where: { callId: ca.id } })).toBe(0);
    expect(await db.callTranscriptLine.count({ where: { callId: cb.id } })).toBe(1);
  });

  it("runs inside `runDueJobs` and a person who is deleted takes their lines with them", async () => {
    const w = await world();
    const c = await endedCall(w, { minutesState: null });
    await addLines(c.id, [{ personId: w.member.id, text: "قديم", at: new Date(Date.now() - 40 * 86_400_000) }]);
    const run = await runDueJobs(new Date());
    expect(run.failed).not.toContain("callTranscripts");
    expect(await db.callTranscriptLine.count({ where: { callId: c.id } })).toBe(0);
    await addLines(c.id, [{ personId: w.admin.id, text: "جديد" }]);
    await db.user.delete({ where: { id: w.admin.id } });
    expect(await db.callTranscriptLine.count({ where: { callId: c.id } })).toBe(0);
  });
});

describe("the end of a call", () => {
  it("queues the minutes only for a call that had the record on", async () => {
    const w = await world();
    const a = await liveCall(w);
    await db.call.update({ where: { id: a }, data: { transcribe: true } });
    await loginAs(w.member.id);
    expect((await call(endRoute.POST, { params: { id: a } })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: a } })).minutesState).toBe("pending");

    const b = await liveCall(w);
    await loginAs(w.member.id);
    expect((await call(endRoute.POST, { params: { id: b } })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: b } })).minutesState).toBeNull();
  });

  it("a call whose record was stopped half way still gets the minutes of the lines it has", async () => {
    const w = await world();
    const c = await liveCall(w);
    await addLines(c, [{ personId: w.member.id, text: "كلام قبل ما نوقّف التسجيل" }]);
    await loginAs(w.member.id);
    expect((await call(endRoute.POST, { params: { id: c } })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: c } })).minutesState).toBe("pending");
  });
});

describe("the minutes", () => {
  it("are built from REDACTED text, posted into the call's conversation as the assistant's line, kept on the call, and the tasks wait as proposal cards (nothing is created)", async () => {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [
      { personId: w.member.id, text: "رقم الزبون 0791234567 وعنوانه شارع الجامعة عمارة 5" },
      { personId: w.admin.id, text: "تمام، نأجل الإطلاق أسبوع وأنا بجهز تقرير الميزانية" },
    ]);
    // earlier tests may have left their own calls waiting: this test looks at exactly its own call
    await db.call.updateMany({ where: { minutesState: "pending", id: { not: c.id } }, data: { minutesState: null } });
    const tasksBefore = await db.task.count();
    const r = await runPendingMinutes(new Date());
    expect(r).toMatchObject({ built: 1 });

    // what reached the model: no phone, no address, no real name
    const sent = JSON.stringify(seen[0]?.messages);
    expect(sent).not.toContain("0791234567");
    expect(sent).not.toContain("شارع الجامعة");
    expect(sent).not.toContain("Member");
    expect(sent).not.toContain("Admin");
    expect(sent).toContain("زميل 1");

    const row = await db.call.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.minutesState).toBe("done");
    const minutes = row.minutes as { summary: string; decisions: string[]; tasks: { title: string; who?: string }[]; proposals: string[] };
    expect(minutes.summary).toContain("الإطلاق");
    expect(minutes.decisions).toEqual(["نأجل الإطلاق أسبوع"]);
    expect(minutes.proposals).toHaveLength(2);

    // the line in the call's conversation: the assistant's, with the cards' ids
    const line = await db.chatMessage.findFirst({ where: { conversationId: w.topic.id, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } } });
    expect(line).toBeTruthy();
    const meta = JSON.parse(line!.body) as { k: string; p: { text: string; props?: string } };
    expect(meta.p.text).toContain("نأجل الإطلاق أسبوع");
    expect(meta.p.props?.split(",")).toHaveLength(2);

    // the tasks are PENDING proposals of the OWNER; no task exists
    const props = await db.aiProposal.findMany({ where: { orgId: w.org.id }, include: { conversation: true } });
    expect(props).toHaveLength(2);
    for (const p of props) {
      expect(p.status).toBe("PENDING");
      expect(p.type).toBe("create_task");
      expect(p.conversation.userId).toBe(w.owner.id);
    }
    expect(await db.task.count()).toBe(tasksBefore);
    // «زميل 1» is the member (the first to speak): the real person is put back on the proposal, and only because he is staff
    expect(props.map((p) => (p.paramsJson as { assigneeId?: string }).assigneeId).filter(Boolean)).toEqual([w.member.id]);

    // the audit line carries counters only
    const audit = await db.auditLog.findFirst({ where: { action: "call.minutes_built", target: c.id } });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.meta)).not.toMatch(/الإطلاق|0791234567/);
  });

  it("the owner approves one card and the task is made by the ordinary service; rejecting makes nothing", async () => {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "لازم نجهز تقرير الميزانية" }]);
    await runPendingMinutes(new Date());
    const [first] = await db.aiProposal.findMany({ where: { orgId: w.org.id }, orderBy: { createdAt: "asc" } });
    const approve = await import("@/app/api/owner-assistant/proposals/[id]/approve/route");
    await loginAs(w.owner.id);
    const done = await call(approve.POST, { params: { id: first!.id } });
    expect(done.status, done.text).toBe(200);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("an empty call (nothing was said) is «empty»: no model call, no message, no cards", async () => {
    const w = await world();
    const c = await endedCall(w);
    expect(await runPendingMinutes(new Date())).toMatchObject({ built: 0, empty: 1 });
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("empty");
    expect(seen).toHaveLength(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
  });

  it("a meeting by link has no conversation: the minutes go to the space's «عام» topic", async () => {
    const w = await world();
    const c = await endedCall(w, { conversationId: null });
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    await runPendingMinutes(new Date());
    expect(await db.chatMessage.count({ where: { conversationId: w.general.id, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } } })).toBe(1);
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("done");
  });

  it("with no place to post (no conversation, no space topic) the minutes stay on the call and are shown at its page", async () => {
    const w = await world();
    await db.conversation.delete({ where: { id: w.general.id } });
    const c = await endedCall(w, { conversationId: null });
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    await runPendingMinutes(new Date());
    const row = await db.call.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.minutesState).toBe("done");
    expect(await db.chatMessage.count({ where: { orgId: w.org.id } })).toBe(0);
    const view = await readMinutes({ orgId: w.org.id, orgRole: "OWNER", userId: w.owner.id }, c.id, { withTranscript: false });
    expect(view.minutes?.summary).toContain("الإطلاق");
  });

  it("a conversation with a GUEST among its people gets NO line (the minutes stay on the call); nothing a guest could read is written", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    await runPendingMinutes(new Date());
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("done");
    expect(await db.chatMessage.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("while the switch is off the minutes wait (nothing is sent anywhere); they are built when it is on again", async () => {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    await setFeature(w.org.id, "meetingMinutes", false);
    expect(await runPendingMinutes(new Date())).toMatchObject({ built: 0 });
    expect(seen).toHaveLength(0);
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("pending");
    await setFeature(w.org.id, "meetingMinutes", true);
    expect(await runPendingMinutes(new Date())).toMatchObject({ built: 1 });
  });

  it("a failing model leaves it pending for a retry in 15 minutes and gives up after a day, never losing the lines", async () => {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    modelFails = true;
    const t0 = new Date();
    expect(await runPendingMinutes(t0)).toMatchObject({ built: 0, waiting: 1 });
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("pending");
    // too soon to try again
    const calls = seen.length;
    await runPendingMinutes(new Date(t0.getTime() + 60_000));
    expect(seen.length).toBe(calls);
    // a day and a bit later it gives up, and the lines are still there for the retention job
    expect(await runPendingMinutes(new Date(t0.getTime() + 26 * 3_600_000))).toMatchObject({ failed: 1 });
    expect((await db.call.findUniqueOrThrow({ where: { id: c.id } })).minutesState).toBe("failed");
    expect(await db.callTranscriptLine.count({ where: { callId: c.id } })).toBe(1);
  });

  it("an answer that is not JSON still gives a summary and never invents a task", async () => {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "نأجل الإطلاق أسبوع" }]);
    modelSays = "اجتماع قصير عن الإطلاق.";
    await runPendingMinutes(new Date());
    const row = await db.call.findUniqueOrThrow({ where: { id: c.id } });
    expect((row.minutes as { summary: string }).summary).toBe("اجتماع قصير عن الإطلاق.");
    expect(await db.aiProposal.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("who reads", () => {
  async function built() {
    const w = await world();
    const c = await endedCall(w);
    await addLines(c.id, [{ personId: w.member.id, text: "كلام الاجتماع الكامل هنا" }]);
    await runPendingMinutes(new Date());
    return { w, id: c.id };
  }

  it("the owner reads the minutes with the cards and, on his page, the full text; the call's host (staff) reads the minutes only", async () => {
    const { w, id } = await built();
    await loginAs(w.owner.id);
    const owner = await state(id);
    expect(owner.status).toBe(200);
    const m = owner.json?.["minutes"] as { summary: string; proposals: string[] } | null;
    expect(m?.summary).toContain("الإطلاق");
    expect(m?.proposals.length).toBeGreaterThan(0);
    const ownerView = await readMinutes({ orgId: w.org.id, orgRole: "OWNER", userId: w.owner.id }, id, { withTranscript: true });
    expect(ownerView.transcript?.map((l) => l.text)).toEqual(["كلام الاجتماع الكامل هنا"]);

    await loginAs(w.member.id); // the host: he started the call
    const host = await state(id);
    const hm = host.json?.["minutes"] as { summary: string; proposals: string[] } | null;
    expect(hm?.summary).toContain("الإطلاق");
    expect(hm?.proposals).toEqual([]);
    const hostView = await readMinutes({ orgId: w.org.id, orgRole: "MEMBER", userId: w.member.id }, id, { withTranscript: true });
    expect(hostView.transcript).toBeUndefined();
    expect(host.text).not.toContain("كلام الاجتماع الكامل");
  });

  it("another member, an admin who did not host, and a guest get no minutes and never a transcript", async () => {
    const { w, id } = await built();
    for (const who of [w.admin, w.guest]) {
      await loginAs(who.id);
      const r = await state(id);
      if (r.status === 200) expect(r.json?.["minutes"]).toBeNull();
      expect(r.text).not.toContain("كلام الاجتماع الكامل");
      await expect(readMinutes({ orgId: w.org.id, orgRole: who.id === w.guest.id ? "GUEST" : "ADMIN", userId: who.id }, id, { withTranscript: true })).rejects.toThrow();
    }
  });

  it("with the switch off the minutes page and route are «not found» for everybody (what was kept stays stored)", async () => {
    const { w, id } = await built();
    await setFeature(w.org.id, "meetingMinutes", false);
    await expect(readMinutes({ orgId: w.org.id, orgRole: "OWNER", userId: w.owner.id }, id, { withTranscript: false })).rejects.toThrow();
    expect(await db.callTranscriptLine.count({ where: { callId: id } })).toBe(1);
  });
});
