import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { projectFieldsCsv } from "@/server/services/custom-fields-export";

/**
 * «حقول مخصصة» — GET the values of one project's fields as a CSV file (UTF-8 with a BOM, formula-safe cells).
 * Whoever may open the project, while the `customFields` switch is on; an external partner gets 403. Every guard is in the service.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { filename, body } = await projectFieldsCsv(params.id);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  });
}
