/**
 * «قوالب المساحات» (I1.2, switch `spaceTemplates`): what a new space of each kind starts with, as PURE data (no React, no server imports).
 *
 * The templates mirror the way the team already works in its Telegram groups, so moving is a matter of opening a space and not of designing one. The data
 * is only a description: `createWorkspace` (src/server/services/workspaces.ts) applies it through `applyTemplateTopics` (src/server/chat/space-topics.ts)
 * for the topics and one helper for the project, inside the NEW space and nowhere else.
 *
 * The rules the data keeps (each one is a test in tests/space-templates.test.ts):
 *  - a topic is a name, a kind and who may write: no person, no message, no customer, no picture and no colour is written here;
 *  - a topic that is `privateByDefault` is created restricted with ONLY its creator in it (the creator adds the people), the rest are open to the space;
 *  - «عام» is the starter topic every space already has (its key is `general`): the template lists it so the order reads as the owner wrote it, and applying
 *    it never makes a second one;
 *  - only «إنتاج المحتوى» holds a project, and a project is never made in «الشركة» (D-N3, the apply step checks the space);
 *  - the pipeline's columns carry the W1.3 normalized stages, so the lists across projects group them without knowing their names.
 */
import type { WorkStage } from "@/lib/work/stage";

export const SPACE_TEMPLATE_KEYS = ["orders", "content", "management", "brand", "blank"] as const;
export type SpaceTemplateKey = (typeof SPACE_TEMPLATE_KEYS)[number];

export type TemplateTopicType = "DISCUSSION" | "ANNOUNCEMENTS" | "TASKS" | "IDEAS" | "FOLLOWUP";

export interface TemplateTopic {
  /** URL-safe and unique inside the template: it is part of the topic's fixed id (`templateTopicIdOf`). */
  key: string;
  title: string;
  emoji: string;
  topicType: TemplateTopicType;
  /** ALL: everybody writes; ADMINS: the space's admins write and everybody reads. */
  postingPolicy: "ALL" | "ADMINS";
  /** Created restricted, with only the creator in it. */
  privateByDefault?: boolean;
}

export interface TemplateStage {
  name: string;
  stage: WorkStage;
  /** The column that means «منتهي» (the flag `BoardColumn.done`, independent of the stage). */
  done?: boolean;
}

export interface TemplateProject {
  /** URL-safe: part of the fixed ids of the project, its board and its columns. */
  key: string;
  name: string;
  boardName: string;
  stages: readonly TemplateStage[];
}

export interface SpaceTemplate {
  key: SpaceTemplateKey;
  name: string;
  /** The space's own emoji (none for «فاضية»: it stays what a space made the old way is). */
  emoji?: string;
  topics: readonly TemplateTopic[];
  projects: readonly TemplateProject[];
}

const topic = (key: string, title: string, emoji: string, extra: Partial<Omit<TemplateTopic, "key" | "title" | "emoji">> = {}): TemplateTopic => ({
  key,
  title,
  emoji,
  topicType: "DISCUSSION",
  postingPolicy: "ALL",
  ...extra,
});

/** «عام»: the starter topic of every space (`SPACE_STARTER_TOPICS`), listed here for the order only. */
const GENERAL = topic("general", "عام", "💬");

export const SPACE_TEMPLATES: readonly SpaceTemplate[] = [
  {
    key: "orders",
    name: "عمليات الطلبات",
    emoji: "📦",
    topics: [
      topic("unconfirmed", "غير مؤكد", "⏳"),
      topic("confirmed", "مؤكد", "✅"),
      topic("returns", "مرتجع", "↩️"),
      // an order's trouble names a customer: private until its creator opens it to the people who handle it
      topic("complaints", "شكاوى", "🚨", { privateByDefault: true }),
      GENERAL,
    ],
    projects: [],
  },
  {
    key: "content",
    name: "إنتاج المحتوى",
    emoji: "🎬",
    topics: [topic("links", "روابط", "🔗"), topic("downloads", "تحميل", "⬇️"), topic("scripts", "سكربتات", "📝"), GENERAL],
    projects: [
      {
        key: "pipeline",
        name: "خط الإنتاج",
        boardName: "خط الإنتاج",
        stages: [
          { name: "فكرة", stage: "TODO" },
          { name: "سكربت", stage: "DOING" },
          { name: "تصوير", stage: "DOING" },
          { name: "مونتاج", stage: "DOING" },
          { name: "جاهز", stage: "REVIEW" },
          { name: "منشور", stage: "DONE", done: true },
        ],
      },
    ],
  },
  {
    key: "management",
    name: "الإدارة",
    emoji: "🧭",
    topics: [
      topic("reports", "تقارير وأداء", "📊"),
      topic("ideas", "أفكار", "💡", { topicType: "IDEAS" }),
      topic("decisions", "قرارات", "📌", { topicType: "FOLLOWUP", privateByDefault: true }),
      topic("ads", "إعلانات", "📣"),
    ],
    projects: [],
  },
  {
    key: "brand",
    name: "منتج / براند",
    emoji: "🏷️",
    topics: [topic("coordination", "تنسيق", "🤝"), topic("ads", "إعلانات", "📣"), topic("content", "محتوى", "🎞️"), topic("issues", "مشاكل", "⚠️")],
    projects: [],
  },
  { key: "blank", name: "فاضية", topics: [], projects: [] },
];

export function isSpaceTemplateKey(value: unknown): value is SpaceTemplateKey {
  return typeof value === "string" && (SPACE_TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** A template by its key, or undefined for anything that is not one of the five. */
export function spaceTemplateOf(key: unknown): SpaceTemplate | undefined {
  return isSpaceTemplateKey(key) ? SPACE_TEMPLATES.find((t) => t.key === key) : undefined;
}

/** The fixed id of a template's own topic in one space: applying the same template twice finds the topic instead of making a second one. */
export const templateTopicIdOf = (spaceId: string, topicKey: string): string => `cv_tpl_${topicKey}_${spaceId}`;

/** The fixed ids of a template project, its board and its columns in one space (same reason). */
export const templateProjectIdOf = (spaceId: string, projectKey: string): string => `pj_tpl_${projectKey}_${spaceId}`;
export const templateBoardIdOf = (spaceId: string, projectKey: string): string => `bd_tpl_${projectKey}_${spaceId}`;
export const templateColumnIdOf = (spaceId: string, projectKey: string, index: number): string => `bc_tpl_${projectKey}_${index}_${spaceId}`;
