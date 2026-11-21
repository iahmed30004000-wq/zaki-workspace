import { runPendingMinutes, type MinutesRun } from "@/server/calls/minutes";
import { purgeExpiredLines } from "@/server/calls/transcripts";

/**
 * «محضر الاجتماع» (S6.2): the two chores of the written lines of calls, in one job of the runner (src/server/jobs/run.ts).
 *   1. RETENTION: every line older than its company's days (default 30) is hard-deleted. Always, whatever the switch says: a line never outlives its days.
 *   2. MINUTES: the calls that had the record on and have ended get their minutes (src/server/calls/minutes.ts), a couple per tick.
 * Idempotent: running it twice does nothing more.
 */
export interface CallTranscriptsRun {
  deleted: number;
  minutes: MinutesRun;
}

export async function runCallTranscripts(now: Date = new Date()): Promise<CallTranscriptsRun> {
  const { deleted } = await purgeExpiredLines(now);
  return { deleted, minutes: await runPendingMinutes(now) };
}
