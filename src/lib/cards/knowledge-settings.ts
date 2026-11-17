import { cleanSpecs, type TemplateOverrides } from "./product-templates";

/**
 * The knowledge settings of a company, read from `Organization.settings` (the owner's alone to change): which space holds the sheets, who
 * writes them (the space's managers always do; these are the others he named), who approves (the owner always does; these are the
 * supervisors he named — D-Q4 default), the one delivery sentence, and the owner's templates by category. Pure: a broken stored value is
 * ignored, never trusted.
 */
export interface KnowledgeSettings {
  spaceId: string | null;
  editorIds: string[];
  approverIds: string[];
  deliveryLine: string;
  templates: TemplateOverrides;
}

export const DELIVERY_LINE_MAX = 120;

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 100) : []);

export function knowledgeSettingsOf(orgSettings: unknown): KnowledgeSettings {
  const s = typeof orgSettings === "object" && orgSettings !== null && !Array.isArray(orgSettings) ? (orgSettings as Record<string, unknown>) : {};
  const templates: TemplateOverrides = {};
  const raw = s["productTemplates"];
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [category, specs] of Object.entries(raw as Record<string, unknown>)) {
      const clean = cleanSpecs(specs);
      if (clean) templates[category] = clean;
    }
  }
  const line = typeof s["knowledgeDeliveryLine"] === "string" ? s["knowledgeDeliveryLine"].trim().slice(0, DELIVERY_LINE_MAX) : "";
  return {
    spaceId: typeof s["knowledgeSpaceId"] === "string" && s["knowledgeSpaceId"] ? s["knowledgeSpaceId"] : null,
    editorIds: ids(s["knowledgeEditorIds"]),
    approverIds: ids(s["knowledgeApproverIds"]),
    deliveryLine: line,
    templates,
  };
}
