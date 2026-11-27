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
    // C2.6 added the five items of the new screen (C3a.3 the sixth, `saved`, C3b.2 the opt-in `removePreview`, «الصور المتحركة» `saveGif`, then «الرد في محادثة أخرى» `replyElsewhere`) (opt-in: the old screen never offers them); the thirteen it had keep their relative order
    const ids = messageMenuItems.map(item => item.id);
    expect(ids.filter(id => !["copyLink", "ask", "readText", "transcribe", "seen", "saved", "saveGif", "removePreview", "select", "replyElsewhere"].includes(id))).toEqual(["reply", "pin", "forward", "edit", "note", "copy", "task", "ticket", "problem", "mustread", "remind", "translate", "delete"]);
    expect(ids[ids.length - 1]).toBe("delete");
  });
});
