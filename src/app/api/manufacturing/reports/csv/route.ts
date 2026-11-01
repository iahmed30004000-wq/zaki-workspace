import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { getServerT } from "@/lib/i18n/server";
import { reportCsv } from "@/lib/manufacturing/csv";
import { REPORT_KINDS, type ReportKind } from "@/lib/manufacturing/production-view";
import { requireActor } from "@/server/policy/actor";
import { readReports, reportQuerySchema } from "@/server/services/manufacturing-reports";

/**
 * A CSV of ONE report (`?spaceId=&report=valuation|consumption|orders|low&from=&to=`), built from the very object the screen reads, so a person
 * without `manufacturing.cost` gets no price column at all. UTF-8 with a BOM, formula-safe cells.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const q = new URL(req.url).searchParams;
    const kind = q.get("report");
    if (!kind || !(REPORT_KINDS as readonly string[]).includes(kind)) throw new ValidationError([{ path: "report", message: "mfg.e.report_kind" }]);
    const parsed = reportQuerySchema.safeParse({ spaceId: q.get("spaceId") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    if (!parsed.success) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    const { t } = getServerT();
    const report = await readReports(actor, parsed.data);
    return new NextResponse(reportCsv(kind as ReportKind, report, t), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="stock-report-${kind}.csv"`, "cache-control": "no-store" },
    });
  });
}
