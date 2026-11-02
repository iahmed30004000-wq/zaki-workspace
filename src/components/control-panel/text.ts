import type { Insight } from "@/lib/control-panel";
import type { ServerT } from "@/lib/i18n/server";

/**
 * An insight written in Arabic: its sentence (`cp.i.<id>`) and its formula (`cp.f.<id>`), both from the dictionary with the insight's own
 * numbers. The names the sentence lists are cut at three by the pure part; «و3 غيرهم» is added here, from the dictionary.
 */
export function insightText(t: ServerT, insight: Insight): { sentence: string; formula: string } {
  const params = { ...insight.params };
  const rest = typeof params["rest"] === "number" ? params["rest"] : 0;
  if (typeof params["names"] === "string" && rest > 0) params["names"] = `${params["names"]}${t("cp.more", { n: rest })}`;
  return { sentence: t(`cp.i.${insight.id}`, params), formula: t(`cp.f.${insight.id}`, params) };
}
