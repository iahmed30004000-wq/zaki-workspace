import { db } from "@/server/db";
import { featureOn } from "@/lib/features";
import { memberCan } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";

/**
 * The gate of the file routes for a proof photo of a receipt: it opens ONLY for the people who may read the receipt, that is to say the
 * ledger's own rule and nothing looser than it:
 *  - the `mfgLedger` switch is on (off, nothing of the ledger opens, the proof included);
 *  - the person is not an external partner and holds `manufacturing.view` right now (read from the database, not the cookie);
 *  - the lot's space is a manufacturing space they may open (a row in it, or the OWNER: who reads silently).
 * It never throws: `assertMayReadFile` falls through to its own 404, so a file id says nothing to anybody else.
 *
 * The photo is a chat upload (`/api/chat/uploads`, sniffed and size-limited like every file) that the receipt then claims: it is not a library
 * file, so it is not listed in «المكتبة» and `files.view` does not open it.
 */
export async function mayReadProofFile(who: { userId: string; orgId: string; role: string }, fileId: string): Promise<boolean> {
  if (who.role === "GUEST") return false;
  const lots = await db.materialLot.findMany({ where: { proofFileId: fileId, orgId: who.orgId }, select: { workspaceId: true } });
  if (lots.length === 0) return false;
  const org = await db.organization.findUnique({ where: { id: who.orgId }, select: { settings: true } });
  if (!featureOn(org?.settings ?? {}, "mfgLedger")) return false;
  if ((await memberCan({ orgId: who.orgId, userId: who.userId }, "manufacturing.view")) !== true) return false;
  const reachable = new Set(await accessibleWorkspaceIds(who.userId));
  for (const lot of lots) {
    if (!reachable.has(lot.workspaceId)) continue;
    const space = await db.workspace.findFirst({ where: { id: lot.workspaceId, organizationId: who.orgId, layout: "MANUFACTURING" }, select: { id: true } });
    if (!space) continue;
    // a guest row of the space is not a reader (the owner needs no row)
    if (who.role === "OWNER") return true;
    const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: lot.workspaceId, userId: who.userId } }, select: { role: true } });
    if (row && row.role !== "GUEST") return true;
  }
  return false;
}
