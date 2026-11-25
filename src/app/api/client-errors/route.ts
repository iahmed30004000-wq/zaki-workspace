import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireUser } from "@/server/auth";
import { parseJson } from "@/server/validation";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { log } from "@/server/log";

/**
 * «أعطال التطبيق» — what went wrong inside the Android app (docs/restructure/M2-native-app.md, N0).
 *
 * A crash cannot make a network call, so the phone keeps each report as a small file and sends them here, up to 20 at a
 * time, once somebody is signed in. They are written to the server's log (one `android.client_error` line each) and to
 * nothing else: no table, no migration. The app never puts a message body, a file name or a customer value in a report;
 * the sizes are capped here too, so a report can never carry a whole answer of the server.
 *
 * Signed-in people only (a pending person too: the onboarding screens can crash), ten calls an hour per person.
 */
const calls = new FixedWindowLimiter({ limit: 10, windowMs: 60 * 60_000 });

const reportSchema = z
  .object({
    kind: z.enum(["CRASH", "ANR", "ERROR"]),
    message: z.string().max(2000),
    stack: z.string().max(16_000).optional(),
    screen: z.string().max(80).optional(),
    appVersion: z.string().max(40),
    versionCode: z.number().int().min(0).max(1_000_000_000).optional(),
    device: z.string().max(120).optional(),
    osVersion: z.string().max(60).optional(),
    occurredAt: z.string().max(40),
  })
  .strict();

const bodySchema = z.object({ reports: z.array(reportSchema).min(1).max(20) }).strict();

/** A stack in a log line: the first frames are what matter, the rest only fills the log. */
const STACK_IN_LOG = 4000;

export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser({ allowPending: true });
    const key = `user:${user.id}`;
    const state = calls.check(key);
    if (!state.ok) throw new RateLimitedError(state.retryAfterSec, "client_errors.too_many");
    calls.hit(key);
    const { reports } = await parseJson(bodySchema, req);
    for (const r of reports) {
      log.warn("android.client_error", {
        userId: user.id,
        kind: r.kind,
        message: r.message,
        stack: r.stack?.slice(0, STACK_IN_LOG),
        screen: r.screen,
        appVersion: r.appVersion,
        versionCode: r.versionCode,
        device: r.device,
        osVersion: r.osVersion,
        occurredAt: r.occurredAt,
      });
    }
    return NextResponse.json({ ok: true, accepted: reports.length });
  });
}
