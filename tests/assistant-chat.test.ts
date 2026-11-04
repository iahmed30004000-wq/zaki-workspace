import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { ASSISTANT_CHAT_PREFIX, assistantChatKey, isAssistantChatKey, isAssistantChatOf } from "@/lib/chat/assistant-chat";

/** «المساعد» كجهة اتصال: the key of a person's conversation with the assistant, its switch and its words, and where it is wired in. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the key of the conversation", () => {
  it("names a person and a space, and only that person recognises it", () => {
    expect(assistantChatKey("u1", "s1")).toBe(`${ASSISTANT_CHAT_PREFIX}u1@s1`);
    expect(isAssistantChatOf("assistant|u1@s1", "u1")).toBe(true);
    expect(isAssistantChatOf("assistant|u1@s1", "u")).toBe(false);
    expect(isAssistantChatOf("assistant|u1@s1", "u2")).toBe(false);
    expect(isAssistantChatOf("u1|u2", "u1")).toBe(false);
    expect(isAssistantChatOf(null, "u1")).toBe(false);
  });

  it("a private chat's pair key is never taken for it", () => {
    expect(isAssistantChatKey("a|b")).toBe(false);
    expect(isAssistantChatKey("a|b@space")).toBe(false);
    expect(isAssistantChatKey(undefined)).toBe(false);
    expect(isAssistantChatKey("assistant|u1@s1")).toBe(true);
  });
});

describe("the switch and the words", () => {
  it("has its own switch (on by default: it is offered only where «@المساعد» is), with words, and economy mode does not own it", () => {
    expect(FEATURES).toContain("assistantContact");
    expect(FEATURE_DEFAULTS.assistantContact).toBe(true);
    expect(AR["features.assistantContact.name"]).toBeTruthy();
    expect(AR["features.assistantContact.hint"]).toContain("⚠️");
    expect(AR["features.assistantContact.hint"]).toContain("🔧");
    for (const key of ["row_title", "row_hint", "open_failed"]) expect(AR[`assistantChat.${key}`], key).toBeTruthy();
    expect(ECONOMY_FORCED_OFF as readonly string[]).not.toContain("assistantContact");
  });
});

describe("where it is wired", () => {
  it("both people lists draw the row only when the server says so, and the route opens the conversation", () => {
    expect(read("src/components/shell/quick-chat.tsx")).toContain("peopleQuery.data?.assistant === true");
    expect(read("src/components/chat/home/new-dm-dialog.tsx")).toContain("data.assistant === true");
    expect(read("src/app/api/chat/directory/route.ts")).toContain("assistantContactOffered(ctx.orgId)");
    expect(read("src/app/api/chat/assistant/route.ts")).toContain("openAssistantChat(ctx, space?.id ?? null)");
  });

  it("an answer without «@» needs the person's OWN conversation and the switch, and nothing else changed for mentions", () => {
    const text = read("src/server/services/chat-assistant.ts");
    expect(text).toContain("isAssistantChatOf(conv.dmKey, authorId)");
    expect(text).toContain('isFeatureOn(orgId, "assistantContact")');
    expect(text).toContain("!mentionsAssistant(msg.body) && !(await inOwnAssistantChat(");
  });

  it("the space's list does not draw somebody else's assistant conversation", () => {
    expect(read("src/server/chat/home.ts")).toContain("isAssistantChatKey(t.dmKey) && t.members.length === 0");
  });
});

describe("a gateway at an outside address is not a small local model", () => {
  it("only a model on the owner's own server gets the short windows and the «local» note", async () => {
    const { runsOnOwnServer } = await import("@/server/services/assistant-provider");
    expect(runsOnOwnServer({ kind: "claude", config: {} })).toBe(false);
    expect(runsOnOwnServer({ kind: "ollama", config: {} })).toBe(true);
    expect(runsOnOwnServer({ kind: "openai", config: {} })).toBe(true);
    expect(runsOnOwnServer({ kind: "openai", config: { external: true } })).toBe(false);
  });

  it("both assistants ask it, not the bare kind", () => {
    expect(read("src/server/services/chat-assistant.ts")).toContain("const local = runsOnOwnServer(choice);");
    expect(read("src/server/services/owner-assistant-chat.ts")).toContain("const local = runsOnOwnServer(choice);");
  });
});

describe("«اتصل بالمساعد»: where it is wired", () => {
  it("the header rings the assistant through the guide's own call, with words and an event", () => {
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain("call={detail?.assistantCall?<AssistantCallButton/>");
    expect(read("src/components/site-guide/assistant-call-button.tsx")).toContain("new CustomEvent(GUIDE_CALL_EVENT)");
    expect(read("src/components/site-guide/site-guide.tsx")).toContain("window.addEventListener(GUIDE_CALL_EVENT, onCall)");
    expect(read("src/server/chat/topics.ts")).toContain("isAssistantChatOf(conv.dmKey, ctx.userId)");
    expect(AR["assistantChat.call"]).toBeTruthy();
  });
});
