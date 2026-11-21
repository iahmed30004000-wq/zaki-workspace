import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import type { Prisma } from "@prisma/client";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as callRoute from "@/app/api/calls/[id]/route";
import * as assistantRoute from "@/app/api/calls/[id]/assistant/route";
import * as turnRoute from "@/app/api/voice-agent/turn/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { AiRequest } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { setAgentFetchForTests, signBody } from "@/server/calls/assistant-agent";
import { assistantTextOf } from "@/server/services/chat-assistant";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * «المساعد بالاجتماعات» — against a real PostgreSQL, a fake calls server, a fake voice agent and a fake model (no network).
 *
 * Pinned: only the OWNER calls the assistant in or out (everybody else «not found»); both switches and the agent's settings are needed; the agent gets
 * a signed request and a pass for ONE room with the identity «assistant»; the agent's question is accepted only with a fresh, correct signature; what
 * reaches the model is filtered; «[صمت]» is silence; an ended call and a switched-off org get nothing; the audit rows carry counters only.
 */

const KEY = "sk-ant-api03-MEETING-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore
const LK_SECRET = "test-calls-secret-0123456789abcdef0123456789";
const AGENT_SECRET = "test-agent-secret-0123456789abcdef";
const saved: Record<string, string | undefined> = {};
const ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "VOICE_AGENT_URL", "VOICE_AGENT_SECRET"];

let rooms = new Map<string, string[]>();
let seen: AiRequest[] = [];
let said = "حاضر";
let agentCalls: { path: string; body: string; headers: Record<string, string> }[] = [];

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
  said = "حاضر";
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
    agentCalls.push({ path: new URL(String(input)).pathname, body: String(init?.body), headers: init?.headers as Record<string, string> });
    return Response.json({ ok: true });
  });
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      return { text: said, toolCalls: [], usage: { inputTokens: 50, outputTokens: 20 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  await setFeature(t.org.id, "ownerAssistant", true);
  await setFeature(t.org.id, "assistantInMeetings", true);
  await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "اجتماع الأسبوع" } });
  await loginAs(t.member.id);
  const started = await call(convCallRoute.POST, { params: { id: topic.id }, body: { video: false, ring: true } });
  expect(started.status, started.text).toBe(201);
  return { ...t, ws, topic, callId: started.json?.["id"] as string };
}

const invite = (callId: string, on = true) => call(assistantRoute.POST, { params: { id: callId }, body: { on } });

/** The agent's question, signed the way the real agent signs it. */
async function ask(callId: string, extra: Record<string, unknown> = {}, opts: { secret?: string; ageSeconds?: number } = {}) {
  const raw = JSON.stringify({ callId, speaker: "أحمد", text: "يا مساعد شو رأيك؟", addressed: true, history: [], ...extra });
  const ts = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
  const req = new Request("http://localhost/api/voice-agent/turn", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-timestamp": String(ts), "x-agent-signature": signBody(opts.secret ?? AGENT_SECRET, ts, raw) },
    body: raw,
  });
  const res = await turnRoute.POST(req);
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text || "null") as Record<string, unknown> | null, text };
}

describe("calling the assistant in", () => {
  it("the owner's invite reaches the agent signed, with a pass for that room only and the identity «assistant»", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const r = await invite(w.callId);
    expect(r.status, r.text).toBe(200);
    expect(agentCalls).toHaveLength(1);
    const sent = agentCalls[0]!;
    expect(sent.path).toBe("/join");
    const ts = Number(sent.headers["x-agent-timestamp"]);
    expect(sent.headers["x-agent-signature"]).toBe(signBody(AGENT_SECRET, ts, sent.body));
    const payload = JSON.parse(sent.body) as { room: string; url: string; token: string; title: string };
    expect(payload).toMatchObject({ room: `zk-${w.callId}`, url: "wss://calls.test.local", title: "اجتماع الأسبوع" });
    const pass = await jwtVerify(payload.token, new TextEncoder().encode(LK_SECRET));
    expect(pass.payload.sub).toBe("assistant");
    expect(pass.payload["video"]).toMatchObject({ room: `zk-${w.callId}`, roomJoin: true });
    const audit = await db.auditLog.findFirst({ where: { action: "assistant.meeting_join", target: w.callId } });
    expect(audit?.actorId).toBe(w.owner.id);
  });

  it("an admin, a member and a guest get «not found»; the agent hears nothing", async () => {
    const w = await world();
    for (const who of [w.admin.id, w.member.id, w.guest.id]) {
      await loginAs(who);
      expect((await invite(w.callId)).status).toBeGreaterThanOrEqual(403);
    }
    expect(agentCalls).toHaveLength(0);
  });

  it("both switches and the agent's settings are needed; a call that ended cannot be joined", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    delete process.env["VOICE_AGENT_URL"];
    const unset = await invite(w.callId);
    expect(unset.status).toBe(403);
    expect(unset.json?.["message"]).toBe("calls.e.assistant_not_configured");
    process.env["VOICE_AGENT_URL"] = "http://voice-agent:8080";
    await setFeature(w.org.id, "assistantInMeetings", false);
    expect((await invite(w.callId)).status).toBe(404);
    await setFeature(w.org.id, "assistantInMeetings", true);
    await db.call.update({ where: { id: w.callId }, data: { endedAt: new Date() } });
    expect((await invite(w.callId)).status).toBe(403);
    expect(agentCalls).toHaveLength(0);
  });

  it("a room that already has the assistant is not asked again; «out» tells the agent to leave", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    rooms.set(`zk-${w.callId}`, [w.owner.id, "assistant"]);
    expect((await invite(w.callId)).status).toBe(200);
    expect(agentCalls).toHaveLength(0);
    expect((await invite(w.callId, false)).status).toBe(200);
    expect(agentCalls.map((c) => c.path)).toEqual(["/leave"]);
  });

  it("the call's data tells only the owner that the assistant can be called, and whether it is in", async () => {
    const w = await world();
    rooms.set(`zk-${w.callId}`, [w.owner.id]);
    await loginAs(w.owner.id);
    expect((await call(callRoute.GET, { params: { id: w.callId } })).json?.["assistant"]).toEqual({ available: true, present: false });
    rooms.set(`zk-${w.callId}`, [w.owner.id, "assistant"]);
    expect((await call(callRoute.GET, { params: { id: w.callId } })).json?.["assistant"]).toEqual({ available: true, present: true });
    await loginAs(w.admin.id);
    expect((await call(callRoute.GET, { params: { id: w.callId } })).json?.["assistant"]).toEqual({ available: false, present: false });
  });
});

describe("what the assistant says", () => {
  it("a signed question gets the model's short answer; the words reach the model filtered", async () => {
    const w = await world();
    said = "أنا معكم، خلينا نبدأ.";
    const r = await ask(w.callId, { text: "اتصلوا فيني على 0791234567 يا مساعد" });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ reply: "أنا معكم، خلينا نبدأ.", silent: false });
    expect(seen).toHaveLength(1);
    const sentToModel = JSON.stringify(seen[0]);
    expect(sentToModel).not.toContain("0791234567");
    expect(sentToModel).toContain("اجتماع الأسبوع");
    expect(seen[0]!.tools ?? []).toHaveLength(0);
    const audit = await db.auditLog.findFirst({ where: { action: "assistant.meeting_turn", target: w.callId } });
    expect(JSON.stringify(audit?.meta)).not.toContain("أنا معكم");
  });

  it("«[صمت]» and an empty answer are silence; markdown is stripped before it is spoken", async () => {
    const w = await world();
    said = "[صمت]";
    expect((await ask(w.callId, { addressed: false })).json).toEqual({ reply: "", silent: true });
    said = "**تمام** # ماشي";
    expect((await ask(w.callId)).json?.["reply"]).toBe("تمام ماشي");
  });

  it("an addressed silence is NOT answered: the model's «[صمت]» or an empty answer stays silent, even when somebody spoke TO the assistant (S6.1)", async () => {
    const w = await world();
    for (const answer of ["[صمت]", ""]) {
      said = answer;
      expect((await ask(w.callId)).json, JSON.stringify(answer)).toEqual({ reply: "", silent: true });
      expect((await ask(w.callId, { addressed: false })).json, JSON.stringify(answer)).toEqual({ reply: "", silent: true });
    }
    expect(await assistantLines(w.topic.id)).toHaveLength(0);
  });

  it("a wrong secret, an old signature or a missing agent setting is «not found»; the model is never called", async () => {
    const w = await world();
    expect((await ask(w.callId, {}, { secret: "another-secret-0123456789abcdef" })).status).toBe(404);
    expect((await ask(w.callId, {}, { ageSeconds: 600 })).status).toBe(404);
    delete process.env["VOICE_AGENT_SECRET"];
    expect((await ask(w.callId)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("an ended call, an org with the switch off, or a bad body get nothing from the model", async () => {
    const w = await world();
    expect((await ask(w.callId, { text: "" })).status).toBe(422);
    await setFeature(w.org.id, "assistantInMeetings", false);
    expect((await ask(w.callId)).status).toBe(404);
    await setFeature(w.org.id, "assistantInMeetings", true);
    await db.call.update({ where: { id: w.callId }, data: { endedAt: new Date() } });
    expect((await ask(w.callId)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("at most 20 answers a minute for one call", async () => {
    const w = await world();
    let last = 200;
    for (let i = 0; i < 22; i += 1) last = (await ask(w.callId)).status;
    expect(last).toBe(429);
    expect(seen.length).toBe(20);
  });
});

// ---------- S6.1: the answer is ALSO a text line of the call's conversation ----------

/** The assistant's lines of a conversation (the same rows «@المساعد» writes: kind SYSTEM, `{k:"assistant", p:{text}}`), oldest first. */
async function assistantLines(conversationId: string) {
  const rows = await db.chatMessage.findMany({ where: { conversationId, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({ ...r, meta: JSON.parse(r.body) as { k: string; p: Record<string, string | number> } }));
}

describe("the text answer (S6.1)", () => {
  it("an answer the assistant speaks in a call is also posted as a line of the call's conversation, in the existing assistant-line shape", async () => {
    const w = await world();
    said = "أنا معكم، خلينا نبدأ.";
    expect((await ask(w.callId)).json).toEqual({ reply: "أنا معكم، خلينا نبدأ.", silent: false });
    const lines = await assistantLines(w.topic.id);
    expect(lines).toHaveLength(1);
    expect(assistantTextOf(lines[0]!.body)).toBe("أنا معكم، خلينا نبدأ.");
    expect(lines[0]!.orgId).toBe(w.org.id);
    // the owner's assistant, the owner's cost: the line carries his row (the screen draws it as «المساعد»)
    expect(lines[0]!.authorId).toBe(w.owner.id);
    // the first assistant line of a conversation carries the note about the model; the next one does not
    expect(lines[0]!.meta.p["first"]).toBe(1);
    expect(lines[0]!.meta.p["err"]).toBeUndefined();
    await ask(w.callId);
    const again = await assistantLines(w.topic.id);
    expect(again).toHaveLength(2);
    expect(again[1]!.meta.p["first"]).toBeUndefined();
    // the conversation's list time moved with the line
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: w.topic.id } });
    expect(conv.lastMessageAt?.getTime()).toBe(again[1]!.createdAt.getTime());
  });

  it("the line is the spoken text (markdown already stripped), the audit row counts it and never holds the words", async () => {
    const w = await world();
    said = "**تمام** # ماشي";
    await ask(w.callId);
    const lines = await assistantLines(w.topic.id);
    expect(assistantTextOf(lines[0]!.body)).toBe("تمام ماشي");
    const audit = await db.auditLog.findFirst({ where: { action: "assistant.meeting_turn", target: w.callId } });
    expect(audit?.meta).toMatchObject({ posted: true });
    expect(JSON.stringify(audit?.meta)).not.toContain("تمام");
  });

  it("a silence writes no line, and a question that was not for the assistant writes none", async () => {
    const w = await world();
    said = "[صمت]";
    await ask(w.callId);
    await ask(w.callId, { addressed: false });
    expect(await assistantLines(w.topic.id)).toHaveLength(0);
  });

  it("a meeting by link has no conversation: the answer is spoken only, nothing breaks", async () => {
    const w = await world();
    const byLink = await db.call.create({ data: { orgId: w.org.id, startedById: w.owner.id, title: "اجتماع برابط" } });
    said = "حاضر يا شباب.";
    const r = await ask(byLink.id);
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ reply: "حاضر يا شباب.", silent: false });
    expect(await db.chatMessage.count({ where: { orgId: w.org.id, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } } })).toBe(0);
    expect((await db.auditLog.findFirst({ where: { action: "assistant.meeting_turn", target: byLink.id } }))?.meta).toMatchObject({ posted: false });
  });

  it("a conversation with a guest among its people gets no line (the voice stays in the room, the text would stay in the history)", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: w.guest.id, role: "GUEST" } });
    said = "تمام.";
    expect((await ask(w.callId)).json).toEqual({ reply: "تمام.", silent: false });
    expect(await assistantLines(w.topic.id)).toHaveLength(0);
  });

  it("a closed or archived conversation takes no line", async () => {
    const w = await world();
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: new Date() } });
    expect((await ask(w.callId)).status).toBe(200);
    expect(await assistantLines(w.topic.id)).toHaveLength(0);
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: null, archivedAt: new Date() } });
    await ask(w.callId);
    expect(await assistantLines(w.topic.id)).toHaveLength(0);
  });

  it("the line is written in the conversation of THAT call only, and the words that reached the model were filtered as before", async () => {
    const w = await world();
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "موضوع ثاني" } });
    said = "جواب.";
    await ask(w.callId, { text: "يا مساعد اتصلوا على 0791234567" });
    expect(await assistantLines(other.id)).toHaveLength(0);
    expect(await assistantLines(w.topic.id)).toHaveLength(1);
    expect(JSON.stringify(seen[0])).not.toContain("0791234567");
    // the question is never written: only the answer
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, body: { contains: "0791234567" } } })).toBe(0);
  });
});
