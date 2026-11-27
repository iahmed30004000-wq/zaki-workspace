import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPACE_TEMPLATES, SPACE_TEMPLATE_KEYS, isSpaceTemplateKey, spaceTemplateOf, templateTopicIdOf } from "@/lib/spaces/templates";
import { WORK_STAGES } from "@/lib/work/stage";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn, featuresOff } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";

/**
 * I1.2 — the templates of «مساحة جديدة» (pure data, `src/lib/spaces/templates.ts`). The data is the whole promise: which topics a space of each kind
 * starts with, which of them are private from the first minute, and the one project with its stages. The service that applies it, and the database
 * behaviour, are proven in tests/db/space-templates.test.ts.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const byKey = (key: string) => {
  const found = spaceTemplateOf(key);
  if (!found) throw new Error(`no template ${key}`);
  return found;
};
const titles = (key: string) => byKey(key).topics.map((t) => t.title);

describe("the five templates", () => {
  it("are exactly: عمليات الطلبات، إنتاج المحتوى، الإدارة، منتج / براند، فاضية, in that order", () => {
    expect([...SPACE_TEMPLATE_KEYS]).toEqual(["orders", "content", "management", "brand", "blank"]);
    expect(SPACE_TEMPLATES.map((t) => t.key)).toEqual([...SPACE_TEMPLATE_KEYS]);
    expect(SPACE_TEMPLATES.map((t) => t.name)).toEqual(["عمليات الطلبات", "إنتاج المحتوى", "الإدارة", "منتج / براند", "فاضية"]);
  });

  it("give each space its topics, in the order the owner wrote them", () => {
    expect(titles("orders")).toEqual(["غير مؤكد", "مؤكد", "مرتجع", "شكاوى", "عام"]);
    expect(titles("content")).toEqual(["روابط", "تحميل", "سكربتات", "عام"]);
    expect(titles("management")).toEqual(["تقارير وأداء", "أفكار", "قرارات", "إعلانات"]);
    expect(titles("brand")).toEqual(["تنسيق", "إعلانات", "محتوى", "مشاكل"]);
    expect(titles("blank")).toEqual([]);
  });

  it("«فاضية» is the old way: no topic and no project beyond the two every space gets", () => {
    expect(byKey("blank").topics).toEqual([]);
    expect(byKey("blank").projects).toEqual([]);
  });

  it("«إنتاج المحتوى» alone has a project, «خط الإنتاج», through six stages فكرة → سكربت → تصوير → مونتاج → جاهز → منشور", () => {
    for (const t of SPACE_TEMPLATES) if (t.key !== "content") expect(t.projects, t.key).toEqual([]);
    const [pipeline, ...rest] = byKey("content").projects;
    expect(rest).toEqual([]);
    expect(pipeline?.name).toBe("خط الإنتاج");
    expect(pipeline?.stages.map((s) => s.name)).toEqual(["فكرة", "سكربت", "تصوير", "مونتاج", "جاهز", "منشور"]);
  });

  it("the pipeline's columns carry W1.3's normalized stages in the order work travels, and only the last one is «منتهي»", () => {
    const stages = byKey("content").projects[0]?.stages ?? [];
    for (const s of stages) expect(WORK_STAGES, s.name).toContain(s.stage);
    expect(stages.map((s) => s.stage)).toEqual(["TODO", "DOING", "DOING", "DOING", "REVIEW", "DONE"]);
    expect(stages.map((s) => s.done === true)).toEqual([false, false, false, false, false, true]);
    // the stages never go backwards through WORK_STAGES
    const order = stages.map((s) => WORK_STAGES.indexOf(s.stage));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(stages.map((s) => s.name)).size).toBe(stages.length);
  });

  it("a topic key is unique inside its template and URL-safe (it becomes part of a fixed id), and «عام» is always the starter's own key", () => {
    for (const t of SPACE_TEMPLATES) {
      const keys = t.topics.map((x) => x.key);
      expect(new Set(keys).size, t.key).toBe(keys.length);
      for (const k of keys) expect(k, `${t.key}/${k}`).toMatch(/^[a-z][a-z0-9-]*$/);
      for (const topic of t.topics) if (topic.title === "عام") expect(topic.key).toBe("general");
    }
  });

  it("two templates that share a topic key share its whole definition, so applying both to one space can never drop a private topic for an open one", () => {
    const seen = new Map<string, string>();
    for (const t of SPACE_TEMPLATES) {
      for (const x of t.topics) {
        const definition = JSON.stringify(x);
        expect(seen.get(x.key) ?? definition, `${t.key}/${x.key}`).toBe(definition);
        seen.set(x.key, definition);
      }
    }
  });

  it("the id of a topic is fixed by its space and key, so applying twice makes it once", () => {
    expect(templateTopicIdOf("sp1", "returns")).toBe("cv_tpl_returns_sp1");
    expect(templateTopicIdOf("sp1", "returns")).toBe(templateTopicIdOf("sp1", "returns"));
    expect(templateTopicIdOf("sp1", "returns")).not.toBe(templateTopicIdOf("sp2", "returns"));
  });

  it("two topics are private from the first minute: «شكاوى» (an order's trouble names a customer) and «قرارات»; nothing else is", () => {
    const priv = SPACE_TEMPLATES.flatMap((t) => t.topics.filter((x) => x.privateByDefault).map((x) => `${t.key}/${x.key}`));
    expect(priv.sort()).toEqual(["management/decisions", "orders/complaints"]);
  });

  it("a topic that only the space's admins write in says so (postingPolicy), the rest are open", () => {
    for (const t of SPACE_TEMPLATES) for (const x of t.topics) expect(["ALL", "ADMINS"], `${t.key}/${x.key}`).toContain(x.postingPolicy);
  });

  it("the topic kinds are the ones a topic may have today", () => {
    for (const t of SPACE_TEMPLATES) for (const x of t.topics) expect(["DISCUSSION", "ANNOUNCEMENTS", "TASKS", "IDEAS", "FOLLOWUP"], `${t.key}/${x.key}`).toContain(x.topicType);
  });

  it("is Arabic only, and carries no Telegram name, no logo, no picture, no customer and no person", () => {
    const text = JSON.stringify(SPACE_TEMPLATES);
    expect(text).not.toMatch(/telegram|تيليجرام|تلجرام|logo|لوغو|شعار|http|\.png|\.jpg|\.svg|@/i);
    for (const t of SPACE_TEMPLATES) {
      const shown = [t.name, ...t.topics.map((x) => x.title), ...t.projects.flatMap((p) => [p.name, p.boardName, ...p.stages.map((s) => s.name)])];
      for (const s of shown) {
        expect(s, s).toMatch(/[؀-ۿ]/);
        expect(s, s).not.toMatch(/[A-Za-z]/);
        expect(s, s).not.toMatch(/\d/);
      }
    }
  });

  it("no colour is written in the data: a column takes the database's own default", () => {
    expect(JSON.stringify(SPACE_TEMPLATES)).not.toMatch(/#[0-9a-fA-F]{3,8}|color/);
  });

  it("isSpaceTemplateKey knows its five keys and nothing else", () => {
    for (const k of SPACE_TEMPLATE_KEYS) expect(isSpaceTemplateKey(k)).toBe(true);
    for (const k of ["", "Orders", "hq", "default", null, undefined, 5]) expect(isSpaceTemplateKey(k)).toBe(false);
    expect(spaceTemplateOf("nope")).toBeUndefined();
  });
});

describe("the switch «قوالب المساحات» (`spaceTemplates`, I1.2)", () => {
  it("is OFF until the owner turns it on, sits with the work switches, and says what it does with its ⚠️ and 🔧", () => {
    expect(FEATURES).toContain("spaceTemplates");
    expect(FEATURE_DEFAULTS.spaceTemplates).toBe(false);
    expect(featureOn({}, "spaceTemplates")).toBe(false);
    expect(featureOn({ features: { spaceTemplates: true } }, "spaceTemplates")).toBe(true);
    expect(featuresOff({})).toContain("spaceTemplates");
    expect(featuresOff({ features: { spaceTemplates: true } })).not.toContain("spaceTemplates");
    expect(FEATURE_META.spaceTemplates.group).toBe("work");
    expect(AR["features.spaceTemplates.name"]).toBe("قوالب المساحات");
    expect(AR["features.spaceTemplates.hint"]).toContain("⚠️");
    expect(AR["features.spaceTemplates.hint"]).toContain("🔧");
  });
});

describe("the strings and the wiring", () => {
  it("every string of the dialog and the guide hint exists in Arabic, with no Latin letter", () => {
    const keys = [
      "spaceTemplates.open",
      "spaceTemplates.title",
      "spaceTemplates.pick",
      "spaceTemplates.name",
      "spaceTemplates.create",
      "spaceTemplates.topics",
      "spaceTemplates.project",
      "spaceTemplates.private",
      "spaceTemplates.privacy_note",
      "spaceTemplates.guide",
      "spaceTemplates.failed",
      "spaces.template_layout",
    ];
    for (const key of keys) {
      expect(AR[key], key).toBeTruthy();
      // a {placeholder} is the program's, not a word on the screen
      expect(AR[key]?.replace(/{[a-z]+}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(AR[key], key).not.toContain("ـاً");
    }
    for (const t of SPACE_TEMPLATES) expect(AR[`spaceTemplates.hint.${t.key}`], t.key).toBeTruthy();
  });

  it("the create route takes an optional `template` key, behind the switch, and passes it to the one create service", () => {
    const route = read("src/app/api/workspaces/route.ts");
    expect(route).toMatch(/template: z\.enum\(SPACE_TEMPLATE_KEYS\)\.optional\(\)/);
    expect(route).toContain('assertFeatureOn(orgId, "spaceTemplates")');
    expect(route).toContain("template: input.template");
    // the switch is asked only when a template was sent: the old create path does not even read the settings
    expect(route).toMatch(/if \(input\.template\) await assertFeatureOn/);
  });

  it("the create service applies the template AFTER the starter topics and through the same two helpers, never a second creator", () => {
    const svc = read("src/server/services/workspaces.ts");
    expect(svc.indexOf("await ensureStarterTopics(input.organizationId, workspace.id)")).toBeGreaterThan(0);
    expect(svc.indexOf("applySpaceTemplate(")).toBeGreaterThan(svc.indexOf("await ensureStarterTopics(input.organizationId, workspace.id)"));
    expect(svc).toContain("applyTemplateTopics");
    expect(read("src/server/chat/space-topics.ts")).toContain("export async function applyTemplateTopics");
  });

  it("the guide article «من تيليجرام لذكي» exists and the dialog links to it", () => {
    expect(read("src/lib/guide/articles.ts")).toContain("من تيليجرام لذكي");
    expect(read("src/components/space-templates/new-space-from-template.tsx")).toContain("/guide/telegram-to-zaki");
  });
});

describe("the interface (src/components/space-templates)", () => {
  const dir = path.join(ROOT, "src/components/space-templates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  const sources = files.map((f) => ({ f, text: readFileSync(path.join(dir, f), "utf8") }));

  it("has the picker and the dialog", () => {
    expect(files.sort()).toEqual(["new-space-from-template.tsx", "template-picker.tsx"]);
  });

  it("keeps the interface rules: theme tokens only, no tiny text, strings through t(), buttons from the button set, touch targets", () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, f).not.toMatch(/bg-(black|white)|text-white/);
      expect(text, f).not.toMatch(/text-\[1[01]px\]/);
      // Tailwind has opacity steps only for 0, 5, 10 ... 100 (anything else is written in brackets)
      for (const m of text.matchAll(/(?:bg|text|border|ring)-[a-z0-9-]+\/(\d+)(?![\d\]])/g)) expect(Number(m[1]) % 5, `${f}: ${m[0]}`).toBe(0);
      // no Arabic literal in the code (a comment may be Arabic): every word on the screen is a key
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/[؀-ۿ]/);
    }
    const dialog = sources.find((s) => s.f === "new-space-from-template.tsx")?.text ?? "";
    expect(dialog).toContain('from "@/components/ui/button"');
    expect(dialog).toContain('"use client"');
    const picker = sources.find((s) => s.f === "template-picker.tsx")?.text ?? "";
    expect(picker).toContain("min-h-11");
    expect(picker).toContain('type="radio"');
  });

  it("the dialog is offered on «كل المساحات» only to a person who may open a space, and only while the switch is on", () => {
    const board = read("src/components/spaces-board.tsx");
    expect(board).toContain("NewSpaceFromTemplate");
    const dialog = sources.find((s) => s.f === "new-space-from-template.tsx")?.text ?? "";
    expect(dialog).toContain("/api/settings/features");
    expect(dialog).toContain("canCreateSpaces");
    expect(dialog).toContain('"spaceTemplates"');
    // it never sends a member, only the template key: nobody is added by a template
    expect(dialog).not.toContain("memberIds");
  });
});
