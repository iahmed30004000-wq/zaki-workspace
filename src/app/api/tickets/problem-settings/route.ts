import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { problemSettingsSchema, readProblemSettings, saveProblemSettings } from "@/server/services/problem-settings";

/** «ضبط التصعيد» (`escalation.configure`): the kinds of problem, the rules that make tickets, the working hours (Q1.5). */
export const dynamic = "force-dynamic";

export async function GET() {
  return withApi(async () => NextResponse.json(await readProblemSettings(await requireActor()), { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(problemSettingsSchema, req);
    return NextResponse.json(await saveProblemSettings(actor, input));
  });
}
