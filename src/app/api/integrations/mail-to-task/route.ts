import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getMailTaskStatus, removeMailTaskConfig, saveMailTaskConfig } from "@/server/services/mail-to-task";
import { mailTaskInputSchema } from "./schema";

/**
 * «بريد يصير مهمة»: the OWNER's card (src/components/mail-to-task-card.tsx).
 * GET: the state and the settings (the password is never in it, only «محفوظة»). PUT: save (404 while the switch is off; refused without
 * ENCRYPTION_KEY). DELETE: take the mailbox out, the password with it (allowed while the switch is off). Anybody who is not the OWNER
 * gets 403 `mail.owner_only`.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return withApi(async () => NextResponse.json(await getMailTaskStatus(await requireActor()), { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(mailTaskInputSchema, req);
    await saveMailTaskConfig(actor, input);
    return NextResponse.json(await getMailTaskStatus(actor), { headers: { "cache-control": "no-store" } });
  });
}

export async function DELETE() {
  return withApi(async () => {
    const actor = await requireActor();
    await removeMailTaskConfig(actor);
    return NextResponse.json(await getMailTaskStatus(actor), { headers: { "cache-control": "no-store" } });
  });
}
