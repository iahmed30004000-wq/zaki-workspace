import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as assistantRoute from "@/app/api/chat/assistant/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { AiCompletion, AiRequest } from "@/server/ai/provider";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { settleChatAssistantForTests } from "@/server/services/chat-assistant";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «المساعد يعرف شغلك» — against a real PostgreSQL and a FAKE provider.
 *
 * What this pins: in a person's OWN conversation with the assistant, the question carries their work picture inside <work>…</work>:
 * the owner gets the company board, anybody else gets ONLY their own open tasks (never a colleague's, never a title while titles are not
 * allowed); an ordinary mention elsewhere carries none; the switch off takes it away.
 */

const KEY = "sk-ant-api03-WORK-TESTKEY-never-appears-1234567890-ABCD"; // scan-secrets:ignore

let seen: AiRequest[] = [];
const script: () => Partial<AiCompletion> = () => ({ text: "ملخص جاهز" });
beforeEach(() => {
  seen = [];
  setProviderFactoryForTests(() => ({
    async complete(request) {
      seen.push(request);
      const out = script();
      return { text: out.text ?? "", toolCalls: [], usage: { inputTokens: 100, outputTokens: 40 } };
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
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة الأحمد" });
  const omar = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "عمر حداد" });
  const ws = await makeWorkspace(t.org.id, [{ userId: sara.id }, { userId: omar.id }, { userId: t.admin.id, role: "ADMIN" }], "المبيعات");
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "حكي المبيعات" } });
  const p = await makeProject(ws.id);
  const base = { orgId: t.org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: t.owner.id };
  const yesterday = new Date(Date.now() - 2 * 86_400_000);
  await makeTask({ ...base, assigneeId: sara.id, title: "عرض سعر لسارة", dueDate: yesterday });
  await makeTask({ ...base, assigneeId: sara.id, title: "مكالمة عميل لسارة" });
  for (const n of [1, 2, 3]) await makeTask({ ...base, assigneeId: omar.id, title: `شغل عمر السري ${n}` });
  await setFeature(t.org.id, "chatAssistant", true);
  await setFeature(t.org.id, "ownerAssistant", true);
  await saveKey({ orgId: t.org.id, userId: t.owner.id }, KEY);
  return { ...t, sara, omar, ws, topic };
}

const open = async (who: string) => {
  await loginAs(who);
  return call(assistantRoute.POST, { method: "POST" });
};
const say = async (who: string, conversationId: string, body: string) => {
  await loginAs(who);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body } });
  await settleChatAssistantForTests();
  return res;
};
const sentText = () => seen.map((r) => r.messages.map((m) => m.content).join("\n")).join("\n");
const workOf = (): { scope: string; [k: string]: unknown } => {
  const m = /<work>\n([\s\S]*?)\n<\/work>/.exec(sentText());
  expect(m, "the question carries <work>").not.toBeNull();
  return JSON.parse(m?.[1] ?? "{}") as { scope: string };
};

describe("the work picture rides along in the person's own conversation", () => {
  it("a member gets ONLY their own open tasks: a count, how many are late, no title while titles are not allowed", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    expect((await say(w.sara.id, id, "بدي ملخص الشغل")).status).toBe(201);
    expect(seen).toHaveLength(1);
    const work = workOf();
    expect(work).toMatchObject({ scope: "mine", openTotal: 2, overdue: 1, tasksShown: 2 });
    expect(seen[0]?.system).toContain("<work>");
    // nobody else's work, and no title (the switch «allowTitles» is off by default)
    expect(sentText()).not.toContain("عمر السري");
    expect(sentText()).not.toContain("عرض سعر لسارة");
  });

  it("the owner gets the company board: the SAME numbers as «مساعد المالك», people as «موظف n»", async () => {
    const w = await world();
    const id = (await open(w.owner.id)).json?.["id"] as string;
    expect((await say(w.owner.id, id, "شو صار؟")).status).toBe(201);
    const work = workOf();
    expect(work["scope"]).toBe("company");
    expect(work["openTasksTotal"]).toBe(5);
    expect(sentText()).not.toContain("عمر حداد");
    expect(sentText()).not.toContain("سارة الأحمد");
  });

  it("a reward task is never counted for a member", async () => {
    const w = await world();
    const reward = await db.task.findFirstOrThrow({ where: { orgId: w.org.id, assigneeId: w.sara.id, title: "مكالمة عميل لسارة" } });
    await db.task.update({ where: { id: reward.id }, data: { rewardStatus: "OPEN" } });
    const id = (await open(w.sara.id)).json?.["id"] as string;
    await say(w.sara.id, id, "بدي ملخص الشغل");
    expect(workOf()).toMatchObject({ scope: "mine", openTotal: 1 });
  });
});

describe("where it does NOT ride along", () => {
  it("an ordinary mention in a topic carries no work picture", async () => {
    const w = await world();
    await say(w.sara.id, w.topic.id, "@المساعد لخّص");
    expect(seen).toHaveLength(1);
    expect(sentText()).not.toContain("<work>");
    expect(seen[0]?.system).not.toContain("<work>");
  });

  it("with its switch off the contact answers from the conversation alone", async () => {
    const w = await world();
    const id = (await open(w.sara.id)).json?.["id"] as string;
    await setFeature(w.org.id, "assistantWorkData", false);
    await say(w.sara.id, id, "بدي ملخص الشغل");
    expect(seen).toHaveLength(1);
    expect(sentText()).not.toContain("<work>");
  });
});
