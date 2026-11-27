import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { ProfileScreen, type ProfileScreenWords } from "@/components/profile/profile-screen";
import { SectionList } from "@/components/settings-me/settings-frame";
import { I18nProvider } from "@/lib/i18n";
import { textOf } from "./ui-render";

/** «بدي الملف الشخصي ما يكون جوّا الإعدادات، منفصل» (the owner, 2026-11-27). */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const words: ProfileScreenWords = { title: "الملف الشخصي", photo: "تغيير الصورة", edit: "تعديل البيانات", settings: "الإعدادات", username: "اسم المستخدم", job: "المسمى الوظيفي", bio: "نبذة", email: "البريد" };
const person = { name: "سارة", username: "sara", jobTitle: "تصميم", bio: null, email: "sara@example.test", avatarUrl: null };
const draw = (withPicture = true) => renderToStaticMarkup(React.createElement(ProfileScreen, { person, words, withPicture }));

describe("the profile's own page", () => {
  it("shows the person, three buttons and only the facts that were written", () => {
    const html = draw();
    expect(textOf(html)).toContain("سارة");
    expect(textOf(html)).toContain("@sara");
    for (const id of ["photo", "edit", "settings"]) expect(html).toContain(`data-profile-action="${id}"`);
    expect(html).toContain('href="/settings/me/account"');
    expect(html).toContain('data-profile-fact="job"');
    expect(html).not.toContain('data-profile-fact="bio"');
  });

  it("offers no picture while the company's picture switch is off", () => {
    expect(draw(false)).not.toContain('data-profile-action="photo"');
  });

  it("is a page only with the bottom bar and never for an external partner; otherwise the old address goes to «حسابي» as before", () => {
    const page = SRC("app/(app)/profile/page.tsx");
    expect(page).toContain('if (actor.isExternal || !(await actorFeatureOn(actor, "tgTabBar"))) redirect(PROFILE_EDIT_HREF);');
    expect(SRC("app/(app)/settings/me/[section]/page.tsx")).toContain('sub = { titleKey: "profileScreen.edit", back: "/profile" };');
    expect(SRC("app/(app)/settings/me/layout.tsx")).toContain("profileApart={tabBarOn && !actor.isExternal}");
  });
});

describe("the links that were about changing something", () => {
  it("go to the form itself: the password card of the settings and «تعديل» on my own card (the profile's page has neither a password nor a form)", () => {
    expect(SRC("app/(app)/settings/page.tsx")).toContain('<Link href={PROFILE_EDIT_HREF} data-settings-password=""');
    expect(SRC("components/profile-card.tsx")).toMatch(/href=\{PROFILE_EDIT_HREF\}\s+data-edit-profile/);
  });
});

describe("the settings on a phone with the bar", () => {
  const list = (profileApart: boolean) => renderToStaticMarkup(React.createElement(I18nProvider, { locale: "ar", children: React.createElement(SectionList, { sections: ["account", "chat"], current: null, profileApart }) } as never));

  it("leave «حسابي» to the profile's tab (a computer keeps the row); without the bar the row is as it was", () => {
    const account = (html: string) => /<li class="([^"]*)"><a[^>]*data-section="account"/.exec(html)?.[1] ?? "";
    expect(account(list(true))).toContain("max-md:hidden");
    expect(account(list(false))).not.toContain("max-md:hidden");
    expect(SRC("components/settings-me/settings-frame.tsx")).toContain('<HeaderCard header={header} className={profileApart ? "max-md:hidden" : undefined} />');
  });
});
