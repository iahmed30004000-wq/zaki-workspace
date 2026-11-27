/**
 * WP-ARABIC1: the wording decisions of 04-REVIEW-A-ARABIC.md, pinned so a later edit cannot quietly
 * undo them — «ركّب» is «ثبّت», «زكي» is «ذكي», no «قريبًا» archive promise, «المؤسسة» is «الشركة», the
 * password rule names the English letter, and no «ـاً» spelling comes back.
 */
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { ARTICLES, articleText } from "@/lib/guide/articles";
import { helpWhatKey, INTERNAL_WHAT_KEY, PAGE_HELP } from "@/lib/guide/page-help";
import { tipsFor } from "@/lib/tips";

describe("WP-ARABIC1: the words the review corrected", () => {
  it("the password rule names the English letter and says «خانات», never «أحرف»", () => {
    expect(AR["auth.passwordRule"]).toBe("8 خانات على الأقل، فيها حرف إنجليزي ورقم.");
    expect(AR["auth.validationHint"]).toContain("حرف إنجليزي ورقم");
    expect(AR["orgm.passwordHint"]).toBe("8 خانات على الأقل، فيها حرف إنجليزي ورقم");
    expect(AR["onboarding.err_letter"]).toContain("حرف إنجليزي");
    expect(AR["onboarding.password_rule"]).toContain("حرف إنجليزي ورقم، ومختلفة عن الحالية.");
  });

  it("nothing promises the archive «قريبًا» or says a delete erases the text (both are false now), and an offboarded person keeps their messages «كما هي»", () => {
    // the code keeps every edit's old text and every deleted body, and the owner's archive exists:
    // the old point of the notice («قريبًا… والحذف بيمسحه») was removed, the notice stays general
    expect(AR["onboarding.notice_archive"]).toBeUndefined();
    for (const [key, text] of Object.entries(AR)) {
      expect(text, key).not.toMatch(/الحذف بيمسح|قريبًا: أي رسالة/);
    }
    for (const a of ARTICLES) expect(articleText(a, "staff"), a.slug).not.toMatch(/الحذف بيمسح|قريبًا: أي رسالة/);
    expect(AR["onboarding.notice_kept"]).toContain("من حق مالك النظام يطّلع عليها");
    expect(AR["members.offboarded_note"]).toContain("كما هي");
    expect(AR["members.act_offboard_hint"]).toContain("كما هي");
    expect(AR["members.confirm_offboard_body"]).toContain("كما هي");
    // nothing claims an existing archive
    for (const key of ["members.offboarded_note", "members.act_offboard_hint", "members.confirm_offboard_body"]) {
      expect(AR[key], key).not.toContain("في الأرشيف");
    }
  });

  it("one thing has one name: «الشركة», «رتبتك», «حسابي», «تسجيل الخروج»", () => {
    expect(AR["settings.org"]).toBe("الشركة");
    expect(AR["settings.orgRenamed"]).toBe("حُدّث اسم الشركة");
    expect(AR["settings.role"]).toBe("رتبتك");
    expect(AR["teams.yourRole"]).toBe("رتبتك");
    expect(AR["profile.title"]).toBe("حسابي");
    expect(AR["common.logout"]).toBe("تسجيل الخروج");
  });

  it("the app is called «ذكي» and the person installs it: «ثبّت», never «ركّب»", () => {
    expect(AR["pwa.install_title"]).toContain("ذكي");
    expect(AR["pwa.region_label"]).toContain("ذكي");
    const everything = Object.values(AR).join("\n") + "\n" + articleText(ARTICLES[0]!, "managers");
    expect(everything).not.toContain("ركّب");
    expect(everything).not.toContain("تركيب");
  });

  it("the guide says «دائرة اسمك» and «المظهر», because there is no photo and the menu item is «المظهر»", () => {
    expect(AR["guide.tour.shell.avatar.title"]).toBe("حسابك");
    expect(AR["guide.tour.shell.avatar.body"]).toContain("المظهر");
    expect(AR["guide.first.open-guide.hint"]).toContain("دائرة اسمك");
    expect(AR["guide.page.home.next_guest"]).toContain("دائرة اسمك");
    const start = ARTICLES.filter((a) => a.slug === "start").map((a) => articleText(a, "managers")).join("\n");
    expect(start).toContain("دائرة اسمك");
    expect(start).not.toContain("صورتك");
  });

  it("the first-steps card matches its buttons: «شخص», «افتح أول مساحة», «ثبّت التطبيق»", () => {
    expect(AR["guide.first.add-person.title"]).toBe("ضيف أول شخص");
    expect(AR["guide.first.review-spaces.title"]).toBe("افتح أول مساحة");
    expect(AR["guide.first.install.title"]).toBe("ثبّت التطبيق على موبايلك");
  });

  it("no string carries the «ـاً» tanween spelling (the house writes «ـًا»: the mark on the letter before the alif)", () => {
    // the old check also required a tanween mark right BEFORE «اً», which a real word never has, so it
    // could not fail; it missed «اختر عضواً» (review C item 7). «اً» alone is the spelling to refuse.
    const offenders = [
      ...Object.entries(AR).map(([key, value]) => [key, value] as const),
      ...ARTICLES.map((a) => [`guide:${a.slug}`, articleText(a, "managers")] as const),
    ]
      .filter(([, value]) => /اً/.test(value))
      .map(([key, value]) => `${key}: ${value.slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("the tanween check does catch «ـاً» (a self-test on a sample)", () => {
    expect(/اً/.test("اختر عضواً")).toBe(true);
    expect(/اً/.test("اختر عضوًا")).toBe(false);
  });

  it("a guest on an internal page is told the page is internal, and gets no chat or files tip", () => {
    const internal = PAGE_HELP.filter((h) => h.guestNextKey === "guide.page.internal.next");
    expect(internal.length).toBeGreaterThan(0);
    for (const help of internal) expect(helpWhatKey(help, "everyone")).toBe(INTERNAL_WHAT_KEY);
    expect(AR[INTERNAL_WHAT_KEY]).toContain("الشريك الخارجي");
    expect(tipsFor("everyone")).not.toContain("tips.chat");
    expect(tipsFor("everyone")).not.toContain("tips.files");
  });
});
