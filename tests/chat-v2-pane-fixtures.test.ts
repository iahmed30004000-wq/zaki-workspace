import { describe, expect, it } from "vitest";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";

/**
 * C2.4 test helper — a header and a message as the server sends them, with the fields a test cares about overridden. It is named `.test.` only so that it
 * stays among the test files (the same way `chat-history-model.test.ts` is), with a test of its own.
 */
export function makeHeader(over: Partial<Omit<ConversationHeaderDto, "me">> & { me?: Partial<ConversationHeaderDto["me"]> } = {}): ConversationHeaderDto {
  const { me, ...rest } = over;
  return {
    id: "c1",
    kind: "TOPIC",
    title: "طلبات اليوم",
    emoji: "📦",
    topicType: "DISCUSSION",
    postingPolicy: "ALL",
    restricted: false,
    teamId: null,
    closed: false,
    archived: false,
    pinned: false,
    space: { id: "s1", name: "المبيعات", hasExternal: false },
    audience: { type: "SPACE", count: 42 },
    memberCount: 42,
    pinnedMessages: [],
    me: { canPost: true, canModerate: false, muted: false, oversight: false, canJoin: false, canCall: true, canMakeWork: true, id: "u1", ...(me ?? {}) },
    ...rest,
  };
}

export function makeMessage(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "m1",
    kind: "TEXT",
    body: "نص الرسالة",
    deleted: false,
    edited: false,
    pinned: false,
    mine: false,
    authorId: "u2",
    authorName: "سلمى",
    createdAt: "2026-11-01T08:30:00.000Z",
    mentions: [],
    attachments: [],
    reactions: [],
    ...over,
  };
}

describe("the pane's fixtures", () => {
  it("build a readable topic header and a plain message", () => {
    expect(makeHeader().me.canPost).toBe(true);
    expect(makeHeader({ me: { canPost: false } }).me.canPost).toBe(false);
    expect(makeMessage({ mine: true }).mine).toBe(true);
  });
});
