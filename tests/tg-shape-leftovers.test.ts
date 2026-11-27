import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The three places the phone still differed from the owner's pictures (2026-11-27): the bar over the chat list, over the settings and the profile, and the line under a name. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");

describe("over the chat list only the name and the «⋮»", () => {
  const bar = SRC("components/chat/v2/phone/list-bar.tsx");
  const menu = SRC("components/chat/v2/list/list-menu.tsx");

  it("«☰» and the notifications move INTO the «⋮», only where the new look draws that menu and there is a drawer to open", () => {
    expect(bar).toContain("const tidy = tg && menu !== undefined && openDrawer !== null;");
    expect(bar).toContain("{bridge?.openDrawer && !tidy ? (");
    expect(bar).toContain("<ListMenuExtrasContext.Provider value={extras}>{menu}</ListMenuExtrasContext.Provider>");
    expect(menu).toContain('data-list-menu-item="drawer"');
    expect(menu).toContain('data-list-menu-item="notifications"');
  });

  it("the bell is still there while something is unread: it hides only while it has no count and was not asked for", () => {
    expect(SRC("components/notification-bell.tsx")).toContain('data-unread-badge=""');
    expect(SRC("app/tg-phone.css")).toContain("[data-tg-phone] [data-chat-phone-trailing][data-tg-quiet]:not(:has([data-unread-badge])) {");
    expect(bar).toContain('{...(tidy && !bellAsked ? { "data-tg-quiet": "" } : {})}');
  });
});

describe("the settings, the profile and a private chat's head", () => {
  it("the app's top bar steps aside on a phone for the settings (with the bottom bar) and the profile's page, which own the notch", () => {
    expect(SRC("components/settings-me/settings-frame.tsx")).toContain('{...(profileApart ? { "data-frame-bars": "hide-top" } : {})}');
    expect(SRC("components/profile/profile-screen.tsx")).toContain('data-profile-screen="" data-frame-bars="hide-top"');
  });

  it("only a PRIVATE chat loses «🔒 بينكم بس» under the name, and only on the phone look; a topic still says who reads it", () => {
    expect(SRC("components/chat/v2/pane/pane-header.tsx")).toContain('{...(header.kind === "DM" ? { "data-privacy-dm": "" } : {})}');
    expect(SRC("app/tg-phone.css")).toContain("[data-tg-phone] header[data-pane-header] [data-privacy-dm],");
  });
});
