import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createRule, listRules, ruleOptions } from "@/server/services/task-rules";

/**
 * «القواعد التلقائية» of one project.
 *
 *  GET   the rules (not the deleted ones) and, with `?options=1`, what the form offers (boards and columns, people, topics).
 *  POST  one rule: `{ name, trigger, boardId?, triggerColumnId?, actions: [one or two] }`. The space's ADMIN or the owner only.
 *
 * Every guard (the project's space and team, the ADMIN role, the projects row, the company's `taskRules` switch, what the rule is
 * allowed to name) lives in the service; the body is checked there by the one validator of a rule (src/lib/task-rules.ts).
 */
const bodySchema = z.object({}).passthrough();

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const withOptions = new URL(req.url).searchParams.get("options") === "1";
    const rules = await listRules(params.id);
    return NextResponse.json(withOptions ? { rules, options: await ruleOptions(params.id) } : { rules });
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const body = await parseJson(bodySchema, req);
    return NextResponse.json({ rule: await createRule(params.id, body) }, { status: 201 });
  });
}
