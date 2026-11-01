import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getBackupStatus, saveBackupConfig } from "@/server/services/db-backup";
import { BACKUP_LIMITS } from "@/lib/db-backup";

/**
 * «نسخ احتياطي لقاعدة البيانات»: the OWNER's screen (src/components/db-backup-card.tsx). GET: the state, the settings and the history
 * (never a Drive link, never data). PUT: the hour and the retention. Anybody who is not the OWNER gets 403 `backup.owner_only`.
 */
export const dynamic = "force-dynamic";

const configSchema = z.object({
  hour: z.number().int().min(0).max(23),
  daily: z.number().int().min(BACKUP_LIMITS.daily.min).max(BACKUP_LIMITS.daily.max),
  weekly: z.number().int().min(BACKUP_LIMITS.weekly.min).max(BACKUP_LIMITS.weekly.max),
});

export async function GET() {
  return withApi(async () => NextResponse.json(await getBackupStatus(await requireActor()), { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(configSchema, req);
    return NextResponse.json({ config: await saveBackupConfig(actor, input) });
  });
}
