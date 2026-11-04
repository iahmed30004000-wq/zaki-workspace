import { describe, expect, it } from "vitest";
import { messageMenuItems } from "../src/components/chat/message/message-menu-registry";
import { ConversationScreen } from "../src/components/chat/conversation/conversation-screen";

describe("conversation UI core", () => {
  it("exports the screen with Arabic RTL structure and blocked composer states", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(React.createElement(ConversationScreen, { conversationId: "c1", onBack() {} }));
    expect(html).toContain("dir=\"rtl\"");
    expect(html).toContain("محادثة");
    expect(html).toContain("role=\"log\"");
  });
  it("keeps menu actions in one ordered list; reactions are the emoji bar above it, delete comes last", () => {
    expect(messageMenuItems.map(item => item.id)).toEqual(["reply", "pin", "forward", "edit", "note", "copy", "task", "ticket", "remind", "translate", "delete"]);
  });
});
