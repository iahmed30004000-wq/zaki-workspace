import { expect } from "vitest";
import type { Prisma } from "@prisma/client";
import * as overviewRoute from "@/app/api/manufacturing/overview/route";
import * as materialsRoute from "@/app/api/manufacturing/materials/route";
import * as materialRoute from "@/app/api/manufacturing/materials/[id]/route";
import * as unitsRoute from "@/app/api/manufacturing/materials/[id]/units/route";
import * as unitRoute from "@/app/api/manufacturing/materials/[id]/units/[unitId]/route";
import * as receiveRoute from "@/app/api/manufacturing/materials/[id]/receive/route";
import * as issueRoute from "@/app/api/manufacturing/materials/[id]/issue/route";
import * as adjustRoute from "@/app/api/manufacturing/materials/[id]/adjust/route";
import * as countRoute from "@/app/api/manufacturing/materials/[id]/count/route";
import * as reverseRoute from "@/app/api/manufacturing/movements/[id]/reverse/route";
import * as decideRoute from "@/app/api/manufacturing/counts/[id]/decide/route";
import * as suppliersRoute from "@/app/api/manufacturing/suppliers/route";
import * as supplierRoute from "@/app/api/manufacturing/suppliers/[id]/route";
import * as csvRoute from "@/app/api/manufacturing/csv/route";
import { withFeature } from "@/lib/features";
import type { MaterialDetail, MfgOverview } from "@/lib/manufacturing/view";
import { call, db, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * Fixtures and shortcuts for the stock-ledger suites (tests/db/mfg-*.test.ts). Every call goes through the real route handlers.
 *
 *  - a MANUFACTURING space with the ledger's usual people: `keeper` (records movements, no cost), `buyer` (records and holds the cost),
 *    `viewer` (reads quantities only), `plain` (in the space, holds nothing of the ledger), the ADMIN (holds view and edit by rank), and the
 *    partner (a guest row in the space);
 *  - `grant` switches capabilities on for one person, the way the owner does from the people screen.
 */

export async function grant(orgId: string, userId: string, capabilities: string[]) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data: { capabilities } });
}

export async function mfgWorld() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const keeper = await makeUser({ orgId, role: "MEMBER", name: "Keeper" });
  const buyer = await makeUser({ orgId, role: "MEMBER", name: "Buyer" });
  const viewer = await makeUser({ orgId, role: "MEMBER", name: "Viewer" });
  const plain = await makeUser({ orgId, role: "MEMBER", name: "Plain" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  await grant(orgId, keeper.id, ["manufacturing.view", "manufacturing.edit"]);
  await grant(orgId, buyer.id, ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"]);
  await grant(orgId, viewer.id, ["manufacturing.view"]);
  await grant(orgId, outsider.id, ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"]);
  const space = await makeWorkspace(
    orgId,
    [
      { userId: keeper.id },
      { userId: buyer.id },
      { userId: viewer.id },
      { userId: plain.id },
      { userId: team.member.id },
      { userId: team.admin.id, role: "ADMIN" },
      { userId: team.guest.id, role: "GUEST" },
    ],
    `Factory ${uid()}`,
  );
  await db.workspace.update({ where: { id: space.id }, data: { layout: "MANUFACTURING" } });
  const general = await makeWorkspace(orgId, [{ userId: keeper.id }, { userId: buyer.id }], `General ${uid()}`);
  return { ...team, keeper, buyer, viewer, plain, outsider, space, general };
}
export type MfgWorld = Awaited<ReturnType<typeof mfgWorld>>;

export const idOf = (id: string) => ({ params: { id } });

export const overview = (spaceId: string) => call(overviewRoute.GET, { url: `http://localhost/api/manufacturing/overview?spaceId=${spaceId}` });
export const overviewOf = async (spaceId: string) => (await overview(spaceId)).json as unknown as MfgOverview;
export const detail = (id: string) => call(materialRoute.GET, idOf(id));
export const detailOf = async (id: string) => ((await detail(id)).json as unknown as { material: MaterialDetail }).material;

export async function makeMaterial(spaceId: string, body: Record<string, unknown> = {}) {
  const res = await call(materialsRoute.POST, { body: { spaceId, name: `مادة ${uid()}`, baseUnit: "علبة", ...body } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return (res.json as unknown as { id: string }).id;
}

export const patchMaterial = (id: string, body: Record<string, unknown>) => call(materialRoute.PATCH, { method: "PATCH", ...idOf(id), body });
export const addUnit = (id: string, body: Record<string, unknown>) => call(unitsRoute.POST, { ...idOf(id), body });
export const archiveUnit = (id: string, unitId: string) => call(unitRoute.DELETE, { method: "DELETE", params: { id, unitId } });
export const issue = (id: string, qty: string, reason = "صرف للتشغيل", unitId: string | null = null) => call(issueRoute.POST, { ...idOf(id), body: { qty, reason, unitId } });
export const adjust = (id: string, qty: string, reason = "تصحيح", unitId: string | null = null) => call(adjustRoute.POST, { ...idOf(id), body: { qty, reason, unitId } });
export const count = (id: string, qty: string, note: string | null = null, unitId: string | null = null) => call(countRoute.POST, { ...idOf(id), body: { qty, note, unitId } });
export const reverse = (movementId: string, reason = "غلط بالإدخال") => call(reverseRoute.POST, { ...idOf(movementId), body: { reason } });
export const decide = (countId: string, decision: "approve" | "reject", note: string | null = null) => call(decideRoute.POST, { ...idOf(countId), body: { decision, note } });
export const addSupplier = (spaceId: string, body: Record<string, unknown> = {}) => call(suppliersRoute.POST, { body: { spaceId, name: `مورد ${uid()}`, ...body } });
export const patchSupplier = (id: string, body: Record<string, unknown>) => call(supplierRoute.PATCH, { method: "PATCH", ...idOf(id), body });
export const csv = (query: string) => call(csvRoute.GET, { url: `http://localhost/api/manufacturing/csv?${query}` });

/** A proof photo as the upload route leaves it: a fresh chat file of this person that no message and no receipt holds yet. */
export async function makeProof(orgId: string, uploaderId: string, over: Partial<{ mimeType: string; purpose: string; name: string }> = {}) {
  const row = await db.storedFile.create({
    data: { orgId, uploaderId, familyId: `fam-${uid()}`, name: over.name ?? "receipt.jpg", path: `uploads/${uid()}`, mimeType: over.mimeType ?? "image/jpeg", size: 1200, purpose: over.purpose ?? "CHAT" },
    select: { id: true },
  });
  return row.id;
}

export const day = (offset = 0) => new Date(Date.now() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10);

/** A receipt body with sane defaults; `proofFileId` or a reason is still the caller's to give. */
export function receiveBody(over: Record<string, unknown> = {}) {
  return { qty: "10", unitCost: "1.5", currency: "JOD", receivedOn: day(), proofNote: "ما في صورة بهالمرة", ...over };
}

export async function receive(materialId: string, over: Record<string, unknown> = {}) {
  return call(receiveRoute.POST, { ...idOf(materialId), body: receiveBody(over) });
}

/** The same sum the ledger defines the balance by, read straight from the table. */
export async function sums(materialId: string): Promise<{ qty: bigint; value: bigint }> {
  const rows = await db.$queryRaw<{ qty: unknown; value: unknown }[]>`SELECT SUM("qtyMicro")::text AS qty, SUM("valueMinor")::text AS value FROM "MaterialMovement" WHERE "materialId" = ${materialId}`;
  return { qty: BigInt(String(rows[0]?.qty ?? 0)), value: BigInt(String(rows[0]?.value ?? 0)) };
}

export async function featureOff(orgId: string, on = false) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "mfgLedger", on) as Prisma.InputJsonValue } });
}

export const micro = (units: number) => units * 1_000_000;
