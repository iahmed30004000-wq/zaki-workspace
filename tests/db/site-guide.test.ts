import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as stepRoute from "@/app/api/site-guide/step/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { AiCompletion, AiRequest, AiToolCall } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { saveKey } from "@/server/services/owner-assistant-settings";

import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «المرشد» — against a real PostgreSQL and a FAKE provider (the network is never touched).
 *
 * What this pins: only the OWNER gets a step (everybody else: «not found»); the switch off or no key refuses; the page reaches the model
 * filtered; what comes back is only what the rules allow (unknown references and unsafe paths are dropped); the ninth step does not call the
 * model; the audit row carries counters and never the page; a bad body is a 422.
 */

const KEY = "sk-ant-api03-GUIDE-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore

let seen: AiRequest[] = [];
let script: () => Partial<AiCompletion> = () => ({ text: "تمام" });
beforeEach(() => {
  seen = [];
  script = () => ({ text: "تمام" });
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      const out = script();
      return { text: out.text ?? "", toolCalls: out.toolCalls ?? [], usage: { inputTokens: 100, outputTokens: 40 } };
    },
  }));
});
afterEach(() => setProviderFactoryForTests(null));

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(withKey = true) {
  const t = await makeTeam();
  await setFeature(t.org.id, "ownerAssistant", true);
  if (withKey) await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  return t;
}

const snapshot = {
  path: "/tasks?secret=1",
  title: "المهام",
  headings: ["مهامي"],
  elements: [
    { ref: "e1", role: "button", name: "مهمة جديدة" },
    { ref: "e2", role: "link", name: "اتصل 0791234567" },
  ],
};
const step = async (who: string, body: Record<string, unknown> = {}) => {
  await loginAs(who);
  return call(stepRoute.POST, { method: "POST", body: { message: "وريني وين أضيف مهمة", history: [], snapshot, step: 0, ...body } });
};
const act = (name: string, input: unknown): AiToolCall => ({ name, input });

describe("who may ask", () => {
  it("the owner gets an answer; an admin, a member and a guest get «not found» or are refused, and the model is never called", async () => {
    const w = await world();
    const ok = await step(w.owner.id);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json).toMatchObject({ say: "تمام", actions: [], done: true });
    expect(seen).toHaveLength(1);
    seen = [];
    for (const who of [w.admin.id, w.member.id, w.guest.id]) expect((await step(who)).status).toBeGreaterThanOrEqual(403);
    expect(seen).toHaveLength(0);
  });

  it("with the switch off, or «مساعد المالك» off, nothing answers; with no key it says so", async () => {
    const w = await world();
    await setFeature(w.org.id, "siteGuide", false);
    expect((await step(w.owner.id)).status).toBe(404);
    await setFeature(w.org.id, "siteGuide", true);
    await setFeature(w.org.id, "ownerAssistant", false);
    expect((await step(w.owner.id)).status).toBe(404);
    expect(seen).toHaveLength(0);
    const bare = await world(false);
    const res = await step(bare.owner.id);
    expect(res.status).toBe(409);
    expect(res.text).toContain("assistant.no_key");
  });
});

describe("what the model reads and what comes back", () => {
  it("the page is filtered (phone masked, query dropped) and the four tools are offered", async () => {
    const w = await world();
    await step(w.owner.id);
    const sent = seen[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(sent).toContain("مهمة جديدة");
    expect(sent).toContain("path: /tasks");
    expect(sent).not.toContain("0791234567");
    expect(sent).not.toContain("secret=1");
    expect(seen[0]?.tools?.map((t) => t.name)).toEqual(["navigate", "highlight", "board_write", "click", "type"]);
  });

  it("only allowed actions come back: known references, a safe path; the rest is dropped", async () => {
    const w = await world();
    script = () => ({
      text: "هاد زر المهمة الجديدة",
      toolCalls: [act("highlight", { ref: "e1", note: "اضغط هون" }), act("click", { ref: "e77" }), act("navigate", { path: "/api/owner-assistant/chat" }), act("run", { code: "x" })],
    });
    const res = await step(w.owner.id);
    expect(res.json).toMatchObject({ say: "هاد زر المهمة الجديدة", actions: [{ type: "highlight", ref: "e1", note: "اضغط هون" }], done: false });
    script = () => ({ toolCalls: [act("navigate", { path: "/chat" }), act("click", { ref: "e1" })] });
    expect((await step(w.owner.id)).json).toMatchObject({ actions: [{ type: "navigate", path: "/chat" }] });
  });

  it("on a whiteboard page the words on the board are read (filtered) and a board request comes back as one action", async () => {
    const w = await world();
    script = () => ({ text: "هاي خطة", toolCalls: [act("board_write", { items: [{ kind: "box", text: "المرحلة الأولى" }, { kind: "note", text: "" }] })] });
    const res = await step(w.owner.id, { snapshot: { ...snapshot, board: ["خطة الشحن", "اتصل بـ 0791234567"] } });
    expect(res.json).toMatchObject({ actions: [{ type: "board", items: [{ kind: "box", text: "المرحلة الأولى" }] }] });
    const sent = seen[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(sent).toContain("board: خطة الشحن");
    expect(sent).not.toContain("0791234567");
  });

  it("the ninth step does not call the model, and a bad body is a 422", async () => {
    const w = await world();
    expect((await step(w.owner.id, { step: 8 })).json).toMatchObject({ actions: [], done: true });
    expect(seen).toHaveLength(0);
    expect((await step(w.owner.id, { snapshot: { path: "/", title: "x", headings: [], elements: [{ ref: "zz", role: "button", name: "x" }] } })).status).toBe(422);
    expect((await step(w.owner.id, { unknown: true })).status).toBe(422);
  });

  it("leaves one audit row of counters, never the page and never the words", async () => {
    const w = await world();
    script = () => ({ text: "كلام سري للمالك", toolCalls: [act("highlight", { ref: "e1", note: "ملاحظة" })] });
    await step(w.owner.id);
    const rows = await db.auditLog.findMany({ where: { orgId: w.org.id, action: "siteguide.step" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta).toMatchObject({ step: 0, controls: 2, actions: 1, dropped: 0 });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("مهمة جديدة");
    expect(dump).not.toContain("كلام سري");
    expect(dump).not.toContain("0791234567");
  });
});
