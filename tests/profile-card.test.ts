import React from "react";
import { describe, expect, it, vi } from "vitest";

// the message button navigates: no router is mounted in a static render
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { ProfileCard } from "../src/components/profile-card";

const profile = {
  id: "u2", name: "سارة", jobTitle: "مسؤولة الشحن", bio: "أحب الترتيب", createdAt: new Date("2026-03-04T10:00:00Z"),
  organizationId: "o1", organizationName: "شركة النخبة", organizationRole: "MEMBER", avatarUrl: null,
  stats: { ideasCreated: 2, ideasVotesReceived: 5, openTasksAssigned: 3, tasksCompleted: 9 },
  sharedSpaces: [{ id: "s1", name: "الشحن", emoji: "🚚" }, { id: "s2", name: "المودريتورز", emoji: null }],
};
const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(ProfileCard, { profile, mine: false, ...extra }));

describe("the profile card (the owner: a profile like a social network's)", () => {
  it("has a cover, the name, the job and the company with the rank", () => {
    const html = render();
    expect(html).toContain("data-cover");
    expect(html).toContain("سارة");
    expect(html).toContain("مسؤولة الشحن");
    expect(html).toContain("شركة النخبة");
  });

  it("someone else's profile offers «راسله»; my own offers «تعديل ملفي» and no message button", () => {
    expect(render()).toContain("data-message-button");
    expect(render()).not.toContain("data-edit-profile");
    const own = render({ mine: true });
    expect(own).toContain("data-edit-profile");
    expect(own).toContain('href="/settings/me/account"');
    expect(own).not.toContain("data-message-button");
  });

  it("shows the bio, since when the person is here, the shared spaces and the four numbers", () => {
    const html = render();
    expect(html).toContain("أحب الترتيب");
    expect(html).toContain("عضو منذ");
    expect(html).toContain("الشحن");
    expect(html).toContain("المودريتورز");
    for (const n of ["2", "5", "3", "9"]) expect(html).toContain(`>${n}<`);
  });

  it("leaves out what is empty: no bio box, no spaces box", () => {
    const html = render({ profile: { ...profile, bio: null, sharedSpaces: [] } });
    expect(html).not.toContain("data-bio");
    expect(html).not.toContain("data-shared-spaces");
  });
});
