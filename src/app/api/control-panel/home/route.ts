import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { controlPanelAccess, loadPanelHome } from "@/server/services/control-panel";
import { insightText } from "@/components/control-panel/text";
import { getServerT } from "@/lib/i18n/server";

/**
 * The phone's «نظرة عامة» of «لوحة التحكم»: what the panel's home draws (`loadPanelHome`), for the owner alone (`controlPanelAccess`:
 * anybody else gets «not found», never «forbidden»). Each insight carries its sentence and its formula already written in Arabic by
 * the panel's own `insightText`, so the phone shows the site's words and nothing of its own. Only counts, dates and staff names.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    const access = await controlPanelAccess(actor);
    const home = await loadPanelHome(access);
    const { t } = getServerT();
    return NextResponse.json({ ...home, insights: home.insights.map((i) => ({ ...i, ...insightText(t, i) })) });
  });
}
