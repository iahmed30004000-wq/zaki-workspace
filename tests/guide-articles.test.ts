import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARTICLES,
  EXTRA_ARTICLE_AUDIENCE,
  articleText,
  articlesFor,
  blocksFor,
  findArticle,
  neighbors,
  readableArticle,
  type Article,
  type Block,
  type ResolvedBlock,
} from "@/lib/guide/articles";
import { ARTICLE_AUDIENCE, AUDIENCES, canRead, type Audience } from "@/lib/guide/audience";
import { ART_SLOTS, isArtSlot } from "@/lib/themes/decor";

const HAS_ARABIC = /[؀-ۿ]/;
/** The only Latin words an article may show: the names of keys on a keyboard and one example user name. */
// "N": the key of «جديد» («نجمة وطريق», the shortcuts article)
const LATIN_ALLOWED = new Set(["Ctrl", "K", "N", "Esc", "Enter", "ali.m", "n8n", "Google", "Drive"]);

const itemText = (item: string | { text: string }) => (typeof item === "string" ? item : item.text);

/** Every string an article can put on the screen, read from the raw data. */
function strings(article: Article): string[] {
  const out = [article.title, article.summary];
  for (const b of article.blocks) {
    switch (b.type) {
      case "h":
      case "p":
      case "tip":
        out.push(b.text);
        break;
      case "warn":
        out.push(b.text, b.fix);
        break;
      case "steps":
      case "list":
        if (b.title) out.push(b.title);
        out.push(...b.items.map(itemText));
        break;
      case "keys":
        out.push(b.text);
        break;
    }
  }
  if (article.cta) out.push(article.cta.label);
  return out;
}

/** Every string of the view one audience gets. */
function viewStrings(article: Article, audience: Audience): string[] {
  const out = [article.title, article.summary];
  for (const b of blocksFor(article, audience)) {
    switch (b.type) {
      case "h":
      case "p":
      case "tip":
        out.push(b.text);
        break;
      case "warn":
        out.push(b.text, b.fix);
        break;
      case "steps":
      case "list":
        if (b.title) out.push(b.title);
        out.push(...b.items);
        break;
      case "keys":
        out.push(b.text);
        break;
    }
  }
  return out;
}

const bySlug = (slug: string): Article => {
  const found = findArticle(slug);
  if (!found) throw new Error(`no article ${slug}`);
  return found;
};

describe("the articles: the data itself", () => {
  it("there are at least ten, with unique URL-safe slugs and unique titles, and the guide opens with «ابدأ من هون»", () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(10);
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug, slug).toMatch(/^[a-z][a-z0-9-]*$/);
    const titles = ARTICLES.map((a) => a.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(ARTICLES[0]?.slug).toBe("start");
    expect(ARTICLES[0]?.title).toBe("ابدأ من هون");
  });

  it("covers every subject the owner asked for", () => {
    const titles = ARTICLES.map((a) => a.title).join("\n");
    for (const wanted of [
      "ابدأ من هون",
      "الأماكن الخمسة",
      "المساحات",
      "المهام",
      "المشاريع",
      "الفريق والصلاحيات",
      "الثيمات الأربعة",
      "تثبيت التطبيق",
      "الخصوصية",
      "اختصارات",
    ]) {
      expect(titles, wanted).toContain(wanted);
    }
  });

  it("is written in Arabic: every title, summary and line has Arabic, and no Latin word except key names", () => {
    for (const article of ARTICLES) {
      for (const text of strings(article)) {
        expect(text, `${article.slug}: ${text}`).toMatch(HAS_ARABIC);
        for (const word of text.match(/[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*/g) ?? []) {
          expect(LATIN_ALLOWED.has(word), `${article.slug}: Latin word «${word}» in «${text}»`).toBe(true);
        }
      }
      for (const b of article.blocks) {
        if (b.type === "keys") for (const key of b.keys) expect(LATIN_ALLOWED.has(key) || !/[A-Za-z]/.test(key), `${article.slug}: key ${key}`).toBe(true);
      }
    }
  });

  it("is short: a summary fits one breath and no single line is a wall of text", () => {
    for (const article of ARTICLES) {
      expect(article.summary.length, article.slug).toBeLessThanOrEqual(110);
      for (const b of article.blocks) {
        const lines =
          b.type === "steps" || b.type === "list"
            ? b.items.map(itemText)
            : b.type === "warn"
              ? [b.text, b.fix]
              : [b.text];
        for (const line of lines) expect(line.length, `${article.slug}: ${line}`).toBeLessThanOrEqual(260);
      }
    }
  });

  it("no line ends in a Latin word or a digit (in right-to-left text the full stop would land on the wrong side)", () => {
    for (const article of ARTICLES) {
      for (const text of strings(article)) {
        expect(text, `${article.slug}: ${text}`).not.toMatch(/[A-Za-z0-9]\s*[.،:؟!)»]*\s*$/);
      }
    }
  });

  it("leaves the ⚠️ and 🔧 marks to the page: the data carries the words, not the symbols", () => {
    for (const article of ARTICLES) {
      for (const text of strings(article)) {
        expect(text).not.toContain("⚠");
        expect(text).not.toContain("🔧");
      }
    }
  });

  it("every warning comes with its fix (a risk is never shown without the way out)", () => {
    let warnings = 0;
    for (const article of ARTICLES) {
      for (const b of article.blocks) {
        if (b.type !== "warn") continue;
        warnings += 1;
        expect(b.text.trim().length, article.slug).toBeGreaterThan(5);
        expect(b.fix.trim().length, article.slug).toBeGreaterThan(5);
      }
    }
    expect(warnings).toBeGreaterThan(0);
  });

  it("agrees with the audience table: every slug is listed there, with the same level", () => {
    // the one table, plus the articles added after it (I1.2: EXTRA_ARTICLE_AUDIENCE, folded into the table by the integrator): no slug is in both
    const table: Record<string, Audience> = { ...ARTICLE_AUDIENCE, ...EXTRA_ARTICLE_AUDIENCE };
    expect(Object.keys(ARTICLE_AUDIENCE).filter((k) => k in EXTRA_ARTICLE_AUDIENCE)).toEqual([]);
    for (const article of ARTICLES) {
      expect(table[article.slug], article.slug).toBe(article.audience);
    }
    expect(Object.keys(table).sort()).toEqual(ARTICLES.map((a) => a.slug).sort());
  });

  it("only uses audiences that exist, and every article has something to read", () => {
    for (const article of ARTICLES) {
      expect(AUDIENCES).toContain(article.audience);
      expect(article.blocks.length, article.slug).toBeGreaterThan(0);
      for (const b of article.blocks) {
        if (b.for) expect(AUDIENCES).toContain(b.for);
        if (b.type === "steps" || b.type === "list") {
          for (const item of b.items) if (typeof item !== "string") expect(AUDIENCES).toContain(item.for ?? "everyone");
        }
      }
      if (article.cta) {
        expect(article.cta.href).toMatch(/^\//);
        expect(AUDIENCES).toContain(article.cta.for ?? "everyone");
      }
    }
  });

  it("describes only what exists today: nothing of the later phases (assistant, calls, cash, penalties, owner's eye)", () => {
    // «المساعدة» (help) is an ordinary word and fine; «المساعد» (the assistant) is a later phase
    // voice messages shipped with the chat (P2): «رسالة صوتية» is today's, no longer a later phase
    // calls shipped on 2026-10-25 (their own article, «المكالمات والاجتماعات»): no longer a later phase
    const later = [/المساعد(?!ة)/, /الجزاءات/, /الصندوق/, /عين المالك/, /بحث بالمعنى/, /الفويس/];
    for (const article of ARTICLES) {
      const text = strings(article).join("\n");
      for (const pattern of later) expect(text, `${article.slug}: ${pattern}`).not.toMatch(pattern);
    }
  });

  it("gives the iPhone steps in the install hint's own words: مشاركة ← إضافة إلى الشاشة الرئيسية, and the Android way", () => {
    const text = articleText(bySlug("install"), "everyone");
    expect(text).toContain("مشاركة");
    expect(text).toContain("إضافة إلى الشاشة الرئيسية");
    expect(text).toContain("آيفون");
    expect(text).toContain("سفاري");
    expect(text).toContain("أندرويد");
    expect(text).toContain("كروم");
  });

  it("says exactly what the install hint says (src/components/pwa/install-hint.tsx): the same labels, the same two taps", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    const text = articleText(bySlug("install"), "everyone");
    // the iPhone steps, word for word
    expect(text).toContain(AR["pwa.ios_step_share"]);
    expect(text).toContain(AR["pwa.ios_step_share_icon"]?.replace(/[()]/g, ""));
    expect(text).toContain(AR["pwa.ios_step_add"]);
    expect(text).toContain(AR["pwa.ios_step_confirm"]);
    // the Android button, by the name it has in the app
    expect(text).toContain(`«${AR["pwa.install_button"]}»`);
  });

  it("names its drawing, when it has one, by an agreed guide slot (the owner's artwork arrives later as public/brand/art/<slot>.webp)", () => {
    const drawn = ARTICLES.filter((a) => a.art !== undefined);
    // the drawings of what exists today: welcome, spaces, install the app
    expect(drawn.map((a) => `${a.slug}:${a.art}`).sort()).toEqual(
      ["install:guide-install-app", "spaces:guide-spaces", "start:guide-welcome"].sort(),
    );
    for (const article of drawn) {
      expect(isArtSlot(article.art), article.slug).toBe(true);
      expect(article.art, article.slug).toMatch(/^guide-/);
    }
    // the slots of drawings for features that do not exist yet (message to task, notifications) stay unused
    const used = new Set(drawn.map((a) => a.art));
    expect(ART_SLOTS.filter((s) => s.startsWith("guide-") && !used.has(s)).sort()).toEqual(["guide-message-to-task", "guide-notifications"]);
  });

  it("the shortcuts article shows Ctrl + K as keys", () => {
    const keys = bySlug("shortcuts").blocks.filter((b): b is Extract<Block, { type: "keys" }> => b.type === "keys");
    expect(keys.some((b) => b.keys.includes("Ctrl") && b.keys.includes("K"))).toBe(true);
  });
});

describe("the articles: who gets which", () => {
  it("articlesFor grows with the audience: guests ⊆ staff ⊆ managers, and managers get everything", () => {
    const guests = articlesFor("everyone").map((a) => a.slug);
    const staff = articlesFor("staff").map((a) => a.slug);
    const managers = articlesFor("managers").map((a) => a.slug);
    for (const slug of guests) expect(staff).toContain(slug);
    for (const slug of staff) expect(managers).toContain(slug);
    expect(managers).toEqual(ARTICLES.map((a) => a.slug));
    expect(guests.length).toBeLessThan(staff.length);
    expect(staff.length).toBeLessThan(managers.length);
  });

  it("an article is listed for exactly the viewers its audience allows, in the guide's order", () => {
    for (const audience of AUDIENCES) {
      const listed = articlesFor(audience);
      expect(listed.every((a) => canRead(audience, a.audience))).toBe(true);
      expect(listed.map((a) => a.slug)).toEqual(
        ARTICLES.filter((a) => canRead(audience, a.audience)).map((a) => a.slug),
      );
    }
  });

  it("the people and permissions article is for managers only; staff and guests never get it", () => {
    expect(articlesFor("managers").map((a) => a.slug)).toContain("team");
    expect(articlesFor("staff").map((a) => a.slug)).not.toContain("team");
    expect(articlesFor("everyone").map((a) => a.slug)).not.toContain("team");
  });

  it("the task, company and team articles are closed to guests (they cannot write, and the rest is internal)", () => {
    const guests = articlesFor("everyone").map((a) => a.slug);
    for (const slug of ["tasks", "company", "team"]) expect(guests, slug).not.toContain(slug);
    for (const slug of ["start", "places", "spaces", "projects", "themes", "install", "privacy", "shortcuts"]) {
      expect(guests, slug).toContain(slug);
    }
  });

  // the chat is a place for EVERYONE now (a guest posts in the topics of their spaces): a guest reads about
  // it, but never about private DMs (a guest has none)
  it("a guest never reads anything about people management, customers, files, private DMs, departments or integrations", () => {
    const forbidden = [
      "CRM",
      "العملاء",
      "الفرص",
      "الملفات",
      "الملف",
      "المكتبة",
      "الأقسام",
      "الروتين",
      "«خاص»",
      "رسالة جديدة",
      "المحادثات",
      "تيليجرام",
      "n8n",
      "الأتمتة",
      "التكاملات",
      "الصلاحيات",
      "المفاتيح",
      "إدارة الحسابات",
      "تصفير",
      "الإدارة",
      "قائد فريق",
      "مشرف",
      "إضافة شخص",
    ];
    for (const article of articlesFor("everyone")) {
      const view = viewStrings(article, "everyone").join("\n");
      for (const word of forbidden) expect(view, `${article.slug} shows a guest «${word}»`).not.toContain(word);
    }
  });

  it("an 'everyone' article shows staff their own material (the library, private DMs) and shows guests none of it; the chat is everyone's", () => {
    const places = bySlug("places");
    expect(viewStrings(places, "staff").join("\n")).toContain("المكتبة");
    expect(viewStrings(places, "staff").join("\n")).toContain("«خاص»");
    expect(viewStrings(places, "everyone").join("\n")).not.toContain("المكتبة");
    expect(viewStrings(places, "everyone").join("\n")).not.toContain("«خاص»");
    expect(viewStrings(places, "everyone").join("\n")).toContain("الدردشة");
  });

  it("staff never get manager-only blocks, and managers get them", () => {
    // the privacy article keeps the integrations remark for staff; the places article's admin line is staff-level
    const spaces = bySlug("spaces");
    const staffView = viewStrings(spaces, "staff").join("\n");
    const guestView = viewStrings(spaces, "everyone").join("\n");
    expect(staffView.length).toBeGreaterThan(guestView.length);
    for (const article of ARTICLES) {
      const staff = blocksFor(article, "staff");
      const managers = blocksFor(article, "managers");
      if (canRead("staff", article.audience)) expect(managers.length).toBeGreaterThanOrEqual(staff.length);
    }
  });

  it("a view never carries an orphan heading (a heading with nothing under it for that audience)", () => {
    for (const article of ARTICLES) {
      for (const audience of AUDIENCES) {
        if (!canRead(audience, article.audience)) continue;
        const blocks: ResolvedBlock[] = blocksFor(article, audience);
        blocks.forEach((b, i) => {
          if (b.type !== "h") return;
          const next = blocks[i + 1];
          expect(next, `${article.slug}/${audience}: «${b.text}» ends the article`).toBeDefined();
          expect(next?.type, `${article.slug}/${audience}: «${b.text}» is followed by a heading`).not.toBe("h");
        });
      }
    }
  });

  it("a view never carries an empty list or empty steps", () => {
    for (const article of ARTICLES) {
      for (const audience of AUDIENCES) {
        if (!canRead(audience, article.audience)) continue;
        for (const b of blocksFor(article, audience)) {
          if (b.type === "steps" || b.type === "list") expect(b.items.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("readableArticle gives the resolved article, and null for an unknown slug or one above the viewer", () => {
    expect(readableArticle("nope", "managers")).toBeNull();
    expect(readableArticle("team", "staff")).toBeNull();
    expect(readableArticle("team", "everyone")).toBeNull();
    expect(readableArticle("tasks", "everyone")).toBeNull();
    const ok = readableArticle("team", "managers");
    expect(ok?.slug).toBe("team");
    expect(ok?.blocks.length).toBeGreaterThan(0);
    // resolved blocks no longer carry the audience marks
    for (const b of ok?.blocks ?? []) expect(b).not.toHaveProperty("for");
  });

  it("findArticle finds by slug whatever the viewer, and says nothing for an unknown one", () => {
    expect(findArticle("tasks")?.title).toContain("المهام");
    expect(findArticle("team")?.audience).toBe("managers");
    expect(findArticle("nope")).toBeUndefined();
    expect(findArticle("")).toBeUndefined();
  });

  it("neighbors chain the articles the viewer can read, and never point at one they cannot", () => {
    for (const audience of AUDIENCES) {
      const listed = articlesFor(audience);
      listed.forEach((article, i) => {
        const { prev, next } = neighbors(article.slug, audience);
        expect(prev?.slug ?? null).toBe(listed[i - 1]?.slug ?? null);
        expect(next?.slug ?? null).toBe(listed[i + 1]?.slug ?? null);
      });
    }
    expect(neighbors("nope", "managers")).toEqual({ prev: null, next: null });
    // the chain a guest follows skips the staff articles
    const guestChain = articlesFor("everyone").map((a) => a.slug);
    expect(guestChain).not.toContain("tasks");
  });

  it("the call to action only shows where the viewer can use it", () => {
    for (const article of ARTICLES) {
      for (const audience of AUDIENCES) {
        if (!canRead(audience, article.audience)) continue;
        const view = readableArticle(article.slug, audience);
        if (view?.cta) expect(canRead(audience, article.cta?.for ?? "everyone")).toBe(true);
      }
    }
  });
});

describe("«الاعتمادات والرخص»: the in-app credits every licence asks for", () => {
  const credits = ARTICLES.find((a) => a.slug === "credits");
  const text = credits ? blocksFor(credits, "everyone").map((b) => ("items" in b ? b.items.join(" ") : "text" in b ? b.text : "")).join(" ") : "";

  it("is in the guide, for everybody (a guest sees the photo too)", () => {
    expect(credits?.audience).toBe("everyone");
    expect(text.length).toBeGreaterThan(100);
  });

  it("says the picture of «المهمّة الجاية» is the project's own drawing, with no third party's work in it", () => {
    for (const part of ["مشهد غروب", "رسم أصلي", "بدون صور أو مواد من طرف تالت"]) expect(text, part).toContain(part);
    // the photograph of Amman was replaced: nobody is credited for a picture that is no longer there
    expect(text).not.toContain("إبراهيم نبيل صالح");
  });

  it("names every font the app ships, each under the open font licence, and the renamed digits", () => {
    for (const font of ["بلكس", "لاله‌زار", "ريم كوفي", "أرقام زاكي"]) expect(text, font).toContain(font);
    expect(text.match(/رخصة الخطوط المفتوحة/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("and every file CREDITS.md credits to a third party has its line here", () => {
    const md = readFileSync(path.join(__dirname, "..", "public", "brand", "CREDITS.md"), "utf8");
    expect(md).not.toContain("Ibrahim Nabeel Salah");
    expect(md).toContain("zaki-digits");
    expect(md).toContain("Lalezar");
  });
});

describe("«من تيليجرام لزاكي» (I1.2): which group becomes which space, who joins, which bot becomes which card", () => {
  const article = () => bySlug("telegram-to-zaki");
  const text = () => articleText(article(), "staff");

  it("exists in the guide for the team (staff and above), never for a guest, and sits before the credits", () => {
    expect(article().title).toBe("من تيليجرام لزاكي");
    expect(article().audience).toBe("staff");
    expect(articlesFor("everyone").map((a) => a.slug)).not.toContain("telegram-to-zaki");
    expect(articlesFor("staff").map((a) => a.slug)).toContain("telegram-to-zaki");
    const slugs = ARTICLES.map((a) => a.slug);
    expect(slugs.indexOf("telegram-to-zaki")).toBe(slugs.indexOf("credits") - 1);
    expect(readableArticle("telegram-to-zaki", "everyone")).toBeNull();
    expect(readableArticle("telegram-to-zaki", "staff")?.blocks.length).toBeGreaterThan(0);
  });

  it("says which Telegram group becomes which space: the four templates and the blank one, with their topics and the pipeline's stages", () => {
    for (const word of ["عمليات الطلبات", "إنتاج المحتوى", "الإدارة", "منتج / براند", "فاضية"]) expect(text(), word).toContain(`«${word}»`);
    for (const topic of ["غير مؤكد", "مؤكد", "مرتجع", "شكاوى", "روابط", "تحميل", "سكربتات", "تقارير وأداء", "أفكار", "قرارات", "إعلانات", "تنسيق", "محتوى", "مشاكل"]) {
      expect(text(), topic).toContain(`«${topic}»`);
    }
    expect(text()).toContain("«خط الإنتاج»");
    expect(text()).toContain("فكرة ثم سكربت ثم تصوير ثم مونتاج ثم جاهز ثم منشور");
  });

  it("says who joins: nobody but the creator and the people they name, and that two topics open private", () => {
    expect(text()).toContain("القالب ما بيضيف حدا");
    expect(text()).toContain("«خاص»");
    expect(text()).toContain("شكاوى");
    expect(text()).toContain("قرارات");
  });

  it("says which bot becomes which card, through the doors that exist, with no customer data", () => {
    expect(text()).toContain("«أحداث نظام الطلبات»");
    expect(text()).toContain("«باب الرسائل»");
    expect(text()).toContain("«افتح الطلب»");
    expect(text()).toContain("بدون مبالغ وبدون بيانات زبائن");
  });

  it("keeps money out of chat: the cash and expenses groups get no template, and nothing is said to be moved from Telegram", () => {
    expect(text()).toContain("ما إلهم قالب");
    expect(text()).toContain("ما في نقل لرسائل تيليجرام القديمة");
    expect(text()).not.toMatch(/شعار|لوغو|صور المجموعة/);
  });

  it("keeps the risk with its fix: a warning about the complaints topic carries the way out", () => {
    const warns = article().blocks.filter((b): b is Extract<Block, { type: "warn" }> => b.type === "warn");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]?.text).toContain("شكاوى");
    expect(warns[0]?.fix).toContain("نظام الطلبات");
  });

  it("is found by its own words in the guide's search", async () => {
    const { search } = await import("@/lib/guide/articles");
    for (const query of ["تيليجرام", "قالب مساحة", "تلجرام قروب"]) {
      expect(search(query, "staff").map((a) => a.slug), query).toContain("telegram-to-zaki");
    }
  });
});
