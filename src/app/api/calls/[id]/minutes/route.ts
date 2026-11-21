import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { readMinutes, type MinutesView } from "@/server/calls/minutes";
import { MINUTES_RETENTION_MAX_DAYS, MINUTES_RETENTION_MIN_DAYS, recordingState, setRecording } from "@/server/calls/transcripts";

const schema = z
  .object({ on: z.boolean().optional(), retentionDays: z.number().int().min(MINUTES_RETENTION_MIN_DAYS).max(MINUTES_RETENTION_MAX_DAYS).optional() })
  .refine((b) => b.on !== undefined || b.retentionDays !== undefined, { message: "validation.failed" });

/**
 * GET: the call room's mark (`recording`: is the text being written, may the viewer change it, how many days it is kept: for anybody who may see the call) and the
 * minutes of the call (`minutes`, only for the owner and the call's own host when staff: everybody else gets `null`, a guest never reads anything). The written
 * lines themselves are NEVER sent from here.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const recording = await recordingState(ctx, params.id);
    let view: MinutesView | null = null;
    try {
      view = await readMinutes(ctx, params.id, { withTranscript: false });
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    return NextResponse.json({ recording, state: view?.state ?? null, minutes: view?.minutes ?? null }, { headers: { "cache-control": "no-store" } });
  });
}

/** POST `{ on?, retentionDays? }`: the OWNER turns the text record of this call on or off, and sets the days the lines are kept. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(schema, req);
    const recording = await setRecording(ctx, params.id, body);
    return NextResponse.json(recording, { headers: { "cache-control": "no-store" } });
  });
}
