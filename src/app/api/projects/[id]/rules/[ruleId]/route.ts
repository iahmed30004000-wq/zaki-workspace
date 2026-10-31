import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { deleteRule, setRuleActive, updateRule } from "@/server/services/task-rules";

/**
 * One rule of a project.
 *
 *  PATCH `{ active: boolean }`  pauses («إيقاف») or resumes it; any other body is a whole rule saved again (the same fields as POST).
 *  DELETE                        takes it off the screen. Its log stays.
 *
 * The space's ADMIN or the owner only; a rule id of another project is «not found».
 */
const bodySchema = z.object({ active: z.boolean().optional() }).passthrough();

export async function PATCH(req: Request, { params }: { params: { id: string; ruleId: string } }) {
  return withApi(async () => {
    const body = await parseJson(bodySchema, req);
    const keys = Object.keys(body);
    if (keys.length === 1 && typeof body.active === "boolean") {
      return NextResponse.json({ rule: await setRuleActive(params.id, params.ruleId, body.active) });
    }
    return NextResponse.json({ rule: await updateRule(params.id, params.ruleId, body) });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; ruleId: string } }) {
  return withApi(async () => {
    await deleteRule(params.id, params.ruleId);
    return NextResponse.json({ ok: true });
  });
}
