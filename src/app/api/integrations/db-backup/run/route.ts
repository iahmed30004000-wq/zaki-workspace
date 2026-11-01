import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { BackupConflictError, runBackupNow } from "@/server/services/db-backup";

/**
 * «اعمل نسخة هلأ»: the OWNER starts a copy. 202 with the run (RUNNING): the copy takes minutes and finishes in the background, its
 * outcome appears in the history. 403 without ENCRYPTION_KEY, 404 while the switch is off, 409 while another copy runs.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  return withApi(async () => {
    try {
      const { run } = await runBackupNow(await requireActor());
      return NextResponse.json({ run }, { status: 202 });
    } catch (err) {
      if (err instanceof BackupConflictError) return apiError("conflict", err.key);
      throw err;
    }
  });
}
