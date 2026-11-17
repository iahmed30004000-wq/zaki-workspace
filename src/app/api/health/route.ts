import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { ensureListener, listenerConnected } from "@/server/realtime/listener";

// Evaluated on every request. Without this Next prerenders the handler at BUILD time (it uses no
// request API), so the answer - including "database: fail" from the build machine - would be
// frozen forever and the container health check could never notice a real database outage.
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness. Reports component status without leaking secrets.
 * Used by Docker HEALTHCHECK and reverse proxies.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {
    app: "ok",
    database: "fail",
  };
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    // 503 below: a container that cannot reach its database must not report itself healthy
  }
  const allOk = Object.values(checks).every((v) => v === "ok");
  // the live line (F0.9): shown, never a reason for a 503 — the database stays the only one. Asking also brings the listener
  // up after a deploy, so the first health check is what starts it rather than the first person who opens a stream.
  let wait: ReturnType<typeof setTimeout> | undefined;
  try {
    // a hung connect must not slow or time out the health check: at most 2 s, then the answer says what it knows
    await Promise.race([ensureListener(), new Promise((resolve) => (wait = setTimeout(resolve, 2_000)))]);
  } catch {
    // ensureListener reports its own failures; the answer below says "down"
  } finally {
    if (wait) clearTimeout(wait);
  }
  const realtime: "ok" | "down" = listenerConnected() ? "ok" : "down";
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, realtime, time: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
