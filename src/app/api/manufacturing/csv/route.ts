import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { getServerT } from "@/lib/i18n/server";
import { lotsCsv, materialsCsv, movementsCsv } from "@/lib/manufacturing/csv";
import { requireActor } from "@/server/policy/actor";
import { readMaterial, readOverview } from "@/server/services/manufacturing";

/**
 * A CSV of EXACTLY what the viewer reads: `?spaceId=` the materials of the space; `?materialId=&what=movements|lots` one material. It is built
 * from the same objects the screens get, so a person without `manufacturing.cost` gets no price column at all. UTF-8 with a BOM, formula-safe cells.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const q = new URL(req.url).searchParams;
    const actor = await requireActor();
    const { t } = getServerT();
    const headers = (name: string) => ({ "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" });
    const materialId = q.get("materialId");
    if (materialId) {
      const what = q.get("what");
      if (what !== "movements" && what !== "lots") throw new ValidationError([{ path: "what", message: "mfg.e.csv_what" }]);
      const detail = await readMaterial(actor, materialId);
      return new NextResponse(what === "movements" ? movementsCsv(detail, t) : lotsCsv(detail, t), { headers: headers(`stock-${what}`) });
    }
    const spaceId = q.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    return new NextResponse(materialsCsv(await readOverview(actor, spaceId), t), { headers: headers("stock-materials") });
  });
}
