import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/auth";
import { assertMayReadFile } from "@/server/services/files";
import { accountsApi, reason } from "./accounts-helpers";
import { call, db, loginAs, makeTeam } from "./helpers";
import { addSupplier, count, csv, decide, detail, detailOf, featureOff, issue, makeMaterial, makeProof, mfgWorld, micro, overview, overviewOf, patchMaterial, receive } from "./mfg-helpers";

/**
 * «مخزون التصنيع»: who may open the ledger and what they are given. Authorization is proven against a real database: an external partner
 * gets 404 whatever was stored for them, a person needs the capability AND a row in the manufacturing space (the owner reads silently), no cost
 * ever reaches a person without `manufacturing.cost`, the proof photo opens only for the people who may read the receipt, the switch
 * turns it all off, and an ADMIN cannot hand out the cost.
 */

describe("the ledger does not exist for an external partner", () => {
  it("a partner gets 404 on every door, even with every ledger capability stored for them", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.guest.id } },
      data: { capabilities: ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"] },
    });
    await loginAs(w.guest.id);
    expect((await overview(w.space.id)).status).toBe(404);
    expect((await detail(id)).status).toBe(404);
    expect((await issue(id, "1")).status).toBe(404);
    expect((await receive(id)).status).toBe(404);
    expect((await csv(`spaceId=${w.space.id}`)).status).toBe(404);
    expect((await addSupplier(w.space.id)).status).toBe(404);
    expect((await patchMaterial(id, { name: "x" })).status).toBe(404);
    // a partner is never given the proof either
    const proof = await makeProof(w.org.id, w.buyer.id);
    await loginAs(w.buyer.id);
    expect((await receive(id, { proofFileId: proof, proofNote: undefined })).status).toBe(201);
    await loginAs(w.guest.id);
    await expect(assertMayReadFile({ orgId: w.org.id, orgRole: "GUEST", userId: w.guest.id }, proof)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the partner holds no ledger capability by rank, and the rank defaults are the owner's decision: cost is the owner's alone", async () => {
    const { RANK_DEFAULTS } = await import("@/server/policy/capabilities");
    expect(RANK_DEFAULTS.GUEST).toEqual([]);
    for (const rank of ["ADMIN", "LEAD", "MEMBER"] as const) expect(RANK_DEFAULTS[rank]).not.toContain("manufacturing.cost");
    for (const rank of ["LEAD", "MEMBER"] as const) {
      expect(RANK_DEFAULTS[rank]).not.toContain("manufacturing.view");
      expect(RANK_DEFAULTS[rank]).not.toContain("manufacturing.edit");
    }
  });
});

describe("a person needs the capability and a row in the manufacturing space", () => {
  it("a member without the capability gets 404, never 403; one with it but outside the space too", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);

    await loginAs(w.plain.id);
    for (const res of [await overview(w.space.id), await detail(id), await issue(id, "1"), await csv(`spaceId=${w.space.id}`)]) expect(res.status).toBe(404);

    // holds everything but has no row in the space
    await loginAs(w.outsider.id);
    for (const res of [await overview(w.space.id), await detail(id), await issue(id, "1"), await addSupplier(w.space.id)]) expect(res.status).toBe(404);
  });

  it("a space that is not a manufacturing space, or is another company's, has no ledger", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    expect((await overview(w.general.id)).status).toBe(404);
    expect((await call((await import("@/app/api/manufacturing/materials/route")).POST, { body: { spaceId: w.general.id, name: "x", baseUnit: "علبة" } })).status).toBe(404);

    const other = await mfgWorld();
    await loginAs(other.buyer.id);
    const foreign = await makeMaterial(other.space.id);
    await loginAs(w.buyer.id);
    expect((await overview(other.space.id)).status).toBe(404);
    expect((await detail(foreign)).status).toBe(404);
    await loginAs(w.owner.id);
    expect((await detail(foreign)).status).toBe(404); // an owner of another company
  });

  it("the owner reads every manufacturing space without a row and leaves no trace of reading", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const before = await db.workspaceMember.count({ where: { workspaceId: w.space.id } });
    const audits = await db.auditLog.count({ where: { orgId: w.org.id } });
    await loginAs(w.owner.id);
    expect((await overview(w.space.id)).status).toBe(200);
    const read = await detail(id);
    expect(read.status).toBe(200);
    expect(await db.workspaceMember.count({ where: { workspaceId: w.space.id } })).toBe(before);
    expect(await db.auditLog.count({ where: { orgId: w.org.id } })).toBe(audits);
  });

  it("a viewer reads the quantities and is refused every write with 403", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10" })).status).toBe(201);
    await loginAs(w.viewer.id);
    const seen = await overviewOf(w.space.id);
    expect(seen).toMatchObject({ canEdit: false, canCost: false });
    expect(seen.materials[0]).toMatchObject({ balanceMicro: micro(10), cost: null });
    expect((await issue(id, "1")).status).toBe(403);
    expect((await receive(id)).status).toBe(403);
    expect((await count(id, "5")).status).toBe(403);
    expect((await patchMaterial(id, { name: "x" })).status).toBe(403);
    expect((await addSupplier(w.space.id)).status).toBe(403);
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(1);
  });

  it("the ADMIN holds view and edit by rank but not the cost; the owner switches the cost on for a named person", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "4", unitCost: "2" })).status).toBe(201);
    await loginAs(w.admin.id);
    const seen = await detailOf(id);
    expect(seen).toMatchObject({ canEdit: true, canCost: false, cost: null });
    expect(seen.lots[0]?.cost).toBeNull();
    // receiving records a price: the admin cannot without the cost
    const refused = await receive(id);
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("mfg.cost_denied");
    // the keeper issues without the cost
    await loginAs(w.keeper.id);
    expect((await issue(id, "1")).status).toBe(201);
  });
});

describe("no cost reaches a person without manufacturing.cost", () => {
  it("every answer is free of a price for a viewer and a keeper, and has it for the cost holder", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    await addSupplier(w.space.id, { name: "المورد الأول" });
    expect((await receive(id, { qty: "10", unitCost: "1.5" })).status).toBe(201);
    expect((await issue(id, "2")).status).toBe(201);
    const full = JSON.stringify((await detail(id)).json);
    expect(full).toContain("totalCostMinor");
    expect(full).toContain("valueMinor");
    expect(JSON.stringify(await overviewOf(w.space.id))).toContain("averageText");

    for (const person of [w.keeper, w.viewer, w.admin]) {
      await loginAs(person.id);
      const body = JSON.stringify((await detail(id)).json);
      for (const word of ["totalCostMinor", "unitCostMinor", "\"valueMinor\":1", "\"valueMinor\":-", "averageText\":\"", "formula\":{"]) expect(body, `${person.name} ${word}`).not.toContain(word);
      const front = JSON.stringify((await overview(w.space.id)).json);
      expect(front, person.name).not.toContain("valueMinor");
      expect(front, person.name).toContain("\"cost\":null");
      const lots = (await detailOf(id)).lots;
      expect(lots.every((l) => l.cost === null)).toBe(true);
      const moves = (await detailOf(id)).movements;
      expect(moves.every((m) => m.valueMinor === null)).toBe(true);
    }
  });

  it("the CSV is exactly what the viewer reads: no price column without the cost, formula-safe cells, no cell starting with a minus", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id, { name: "=HYPERLINK(\"x\")", code: "+1" });
    expect((await receive(id, { qty: "10", unitCost: "1.5" })).status).toBe(201);
    expect((await issue(id, "3", "@cmd صرف")).status).toBe(201);

    const withCost = await csv(`spaceId=${w.space.id}`);
    expect(withCost.status).toBe(200);
    expect(withCost.headers.get("content-type")).toContain("text/csv");
    expect(withCost.text).toContain("المتوسط المرجّح");
    expect(withCost.text).toContain("'=HYPERLINK");
    expect(withCost.text).toContain("'+1");
    expect(withCost.text).not.toMatch(/(^|,|\r\n)=HYPERLINK/);

    const moves = await csv(`materialId=${id}&what=movements`);
    expect(moves.text).toContain("'@cmd صرف");
    for (const row of moves.text.replace(/^﻿/, "").split("\r\n").filter(Boolean)) {
      for (const cell of row.split(",")) expect(cell.startsWith("-"), cell).toBe(false);
    }
    expect(moves.text).toContain("قيمة خارجة");

    await loginAs(w.keeper.id);
    const plain = await csv(`spaceId=${w.space.id}`);
    expect(plain.status).toBe(200);
    for (const word of ["المتوسط المرجّح", "قيمة المخزون", "العملة"]) expect(plain.text).not.toContain(word);
    for (const what of ["movements", "lots"]) {
      const file = await csv(`materialId=${id}&what=${what}`);
      for (const word of ["قيمة داخلة", "قيمة خارجة", "سعر الوحدة", "المجموع", "العملة"]) expect(file.text, `${what} ${word}`).not.toContain(word);
    }
    expect((await csv(`materialId=${id}&what=nothing`)).status).toBe(422);
    await loginAs(w.guest.id);
    expect((await csv(`materialId=${id}&what=lots`)).status).toBe(404);
  });
});

describe("the proof photo opens only for the people who may read the receipt", () => {
  it("members of the space with the capability and the owner may; a plain member, an outsider, a partner and everybody once the switch is off may not", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const proof = await makeProof(w.org.id, w.buyer.id);
    const done = await receive(id, { proofFileId: proof, proofNote: undefined });
    expect(done.status).toBe(201);
    const may = (userId: string, orgRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST") => assertMayReadFile({ orgId: w.org.id, orgRole, userId }, proof);

    await expect(may(w.viewer.id, "MEMBER")).resolves.toBeUndefined();
    await expect(may(w.keeper.id, "MEMBER")).resolves.toBeUndefined();
    await expect(may(w.admin.id, "ADMIN")).resolves.toBeUndefined();
    await expect(may(w.owner.id, "OWNER")).resolves.toBeUndefined();
    for (const [person, rank] of [[w.plain, "MEMBER"], [w.outsider, "MEMBER"], [w.guest, "GUEST"], [w.member, "MEMBER"]] as const) {
      // `member` is in the space but holds no ledger capability; `plain` too; `outsider` holds all of them with no row
      await expect(may(person.id, rank), person.name).rejects.toBeInstanceOf(NotFoundError);
    }

    // the same photo opens nothing in the library: it is a chat file, not a library file
    const other = await mfgWorld();
    await expect(assertMayReadFile({ orgId: other.org.id, orgRole: "OWNER", userId: other.owner.id }, proof)).rejects.toBeInstanceOf(NotFoundError);

    await featureOff(w.org.id);
    await expect(may(w.owner.id, "OWNER")).rejects.toBeInstanceOf(NotFoundError);
    await featureOff(w.org.id, true);
    await expect(may(w.viewer.id, "MEMBER")).resolves.toBeUndefined();
  });

  it("a proof file that is somebody else's, already used, a chat message's or not a picture is refused", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const theirs = await makeProof(w.org.id, w.keeper.id);
    const pdf = await makeProof(w.org.id, w.buyer.id, { mimeType: "application/pdf", name: "r.pdf" });
    const zip = await makeProof(w.org.id, w.buyer.id, { mimeType: "application/zip", name: "r.zip" });
    const library = await makeProof(w.org.id, w.buyer.id, { purpose: "LIBRARY" });
    const mine = await makeProof(w.org.id, w.buyer.id);
    for (const bad of [theirs, zip, library, "nope"]) {
      const res = await receive(id, { proofFileId: bad, proofNote: undefined });
      expect(res.status, bad).toBe(422);
    }
    expect((await receive(id, { proofFileId: pdf, proofNote: undefined })).status).toBe(201);
    expect((await receive(id, { proofFileId: mine, proofNote: undefined })).status).toBe(201);
    // each photo proves ONE receipt
    expect((await receive(id, { proofFileId: mine, proofNote: undefined })).status).toBe(422);
    expect(await db.materialLot.count({ where: { materialId: id } })).toBe(2);
  });
});

describe("the switch and the people screen", () => {
  it("the switch off: every door answers 404 features.off for everybody, the owner included; the data stays and comes back", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id)).status).toBe(201);
    await featureOff(w.org.id);
    for (const person of [w.buyer, w.owner]) {
      await loginAs(person.id);
      for (const res of [await overview(w.space.id), await detail(id), await issue(id, "1"), await csv(`spaceId=${w.space.id}`)]) {
        expect(res.status).toBe(404);
        expect(res.json?.["message"] ?? "features.off").toBe("features.off");
      }
    }
    expect(await db.materialMovement.count({ where: { materialId: id } })).toBe(1);
    await featureOff(w.org.id, true);
    await loginAs(w.buyer.id);
    expect((await detail(id)).status).toBe(200);
  });

  it("an ADMIN can hand out view and edit but not the cost; only the owner hands out the cost", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    const view = await accountsApi.update(t.org.id, t.member.id, { capabilities: ["manufacturing.view", "manufacturing.edit"] });
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    const cost = await accountsApi.update(t.org.id, t.member.id, { capabilities: ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"] });
    expect(cost.status).toBe(403);
    expect(reason(cost)).toBe("accounts.cap_not_held");
    await loginAs(t.owner.id);
    expect((await accountsApi.update(t.org.id, t.member.id, { capabilities: ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"] })).status).toBe(200);
    // a partner is given none of them
    const toGuest = await accountsApi.update(t.org.id, t.guest.id, { capabilities: ["manufacturing.view"] });
    expect(toGuest.status).toBe(403);
    expect(reason(toGuest)).toBe("accounts.cap_not_for_guests");
  });

  it("a stocktake needs a second person who holds the edit capability; a viewer cannot approve", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    expect((await receive(id, { qty: "10" })).status).toBe(201);
    await loginAs(w.keeper.id);
    const started = await count(id, "8");
    expect(started.status).toBe(201);
    const countId = (started.json as unknown as { count: { id: string } }).count.id;
    await loginAs(w.viewer.id);
    expect((await decide(countId, "approve")).status).toBe(403);
    await loginAs(w.plain.id);
    expect((await decide(countId, "approve")).status).toBe(404);
  });
});
