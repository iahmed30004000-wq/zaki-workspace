import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { db, loginAs } from "./helpers";
import { approvalOf, approvalsWorld, bell, create, createForm, decide, detailKey, detailPath, editForm, fill, list, listForms, makeUpload, messageOf, read, readForm, resubmit, type AWorld } from "./approvals-helpers";
import { assertMayReadFile } from "@/server/services/files";
import { ensureStarterTopics, spaceTopicIdOf } from "@/server/chat/space-topics";
import { withFeature } from "@/lib/features";
import { expenseSchema, transferSchema } from "@/lib/approvals/forms";
import { WIRED_CAPABILITIES, can } from "@/server/policy/capabilities";
import { mayReadApprovalFile } from "@/server/services/approval-access";

/**
 * I1.3 «طلب مصروف» and «تحويل بين الصناديق»: office money goes through the EXISTING approvals module (two templates, a `purpose` on the
 * form), is decided in the app only, and the decision is posted as a card into the space's «عام» topic with no amount in the message.
 * The amount of such a request is cut on the server for everybody who holds neither `prices.view` nor `cash.view` (the person who asked
 * keeps their own); the receipt photo is cut with it. Nothing here touches the orders system's wallets or cash balances.
 */

const BOXES = ["صندوق المكتب", "صندوق المصاريف"];
const GOOD = { amount: 12.5, currency: "دينار", box: BOXES[0]!, reason: "ورق طباعة للمكتب" };
const TRANSFER = { amount: 40, currency: "دينار", from_box: BOXES[0]!, to_box: BOXES[1]!, reason: "تغطية مصاريف الأسبوع" };

async function setSettings(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = { ...((org.settings as Record<string, unknown> | null) ?? {}) };
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

async function setup(opts: { on?: boolean } = {}) {
  const w = await approvalsWorld();
  await setSettings(w.orgId, { expenseForms: opts.on !== false });
  await ensureStarterTopics(w.orgId, w.ws.id);
  return w;
}

const FAMILY = (res: { json: Record<string, unknown> | null }) => (res.json?.["form"] as { familyId: string }).familyId;

/** The manager (the space's ADMIN) writes the form; returns its family id. */
async function makeForm(w: AWorld, kind: "expense" | "transfer", approvers: string[], over: Record<string, unknown> = {}): Promise<string> {
  await loginAs(w.admin.id);
  const schema = kind === "expense" ? expenseSchema({ boxes: BOXES, approvers }) : transferSchema({ boxes: BOXES, approvers });
  const res = await createForm({ workspaceId: w.ws.id, name: kind === "expense" ? "طلب مصروف" : "تحويل بين الصناديق", schema, ...over });
  if (res.status !== 201) throw new Error(`could not make the form: ${res.status} ${res.text}`);
  return FAMILY(res);
}

async function ask(w: AWorld, as: { id: string }, family: string, answers: Record<string, unknown>, fileIds?: string[]) {
  await loginAs(as.id);
  return fill(family, { answers, ...(fileIds ? { fileIds } : {}) });
}

const cardsOf = (w: AWorld) => db.chatMessage.findMany({ where: { conversationId: spaceTopicIdOf(w.ws.id, "general"), kind: "CARD" }, orderBy: { createdAt: "asc" } });

async function grant(orgId: string, userId: string, data: { capabilities?: string[]; revokedCapabilities?: string[] }) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
}

describe("the switch and who defines the two forms", () => {
  it("with expenseForms OFF (the default) no money form can be made, filled or listed; the ordinary forms are untouched", async () => {
    const w = await setup({ on: false });
    await loginAs(w.admin.id);
    const res = await createForm({ workspaceId: w.ws.id, name: "طلب مصروف", schema: expenseSchema({ boxes: BOXES, approvers: [w.lead.id] }) });
    expect(res.status).toBe(404);
    expect(messageOf(res)).toBe("features.off");
    expect(await db.formTemplate.count({ where: { orgId: w.orgId } })).toBe(0);
    // an ordinary form (no purpose) is made as before
    const plain = await createForm({ workspaceId: w.ws.id, name: "نموذج عادي", schema: { fields: [{ id: "f1", type: "text", label: "الاسم", required: true }], approvers: [w.lead.id] } });
    expect(plain.status).toBe(201);
  });

  it("the form that was made while it was ON stops being offered, and cannot be filled, when it is switched OFF; the requests already made stay readable", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const made = await ask(w, w.member, family, GOOD);
    expect(made.status).toBe(201);
    await setSettings(w.orgId, { expenseForms: false });
    await loginAs(w.member.id);
    expect(((await listForms(w.ws.id)).json?.["forms"] as unknown[]).length).toBe(0);
    expect((await readForm(family)).status).toBe(404);
    const again = await fill(family, { answers: GOOD });
    expect(again.status).toBe(404);
    expect(messageOf(again)).toBe("features.off");
    expect((await read(approvalOf(made)["id"] as string)).status).toBe(200);
    await loginAs(w.admin.id);
    expect(((await listForms(w.ws.id)).json?.["forms"] as unknown[]).length).toBe(0);
  });

  it("only the space's manager defines them; a member, a guest and a stranger cannot, with the ordinary refusals", async () => {
    const w = await setup();
    const body = { workspaceId: w.ws.id, name: "طلب مصروف", schema: expenseSchema({ boxes: BOXES, approvers: [w.lead.id] }) };
    for (const who of [w.member, w.lead]) {
      await loginAs(who.id);
      const res = await createForm(body);
      expect(res.status, who.name).toBe(403);
      expect(messageOf(res), who.name).toBe("approvals.f.manage_denied");
    }
    await loginAs(w.guest.id);
    expect(messageOf(await createForm(body))).toBe("guest.no_access");
    await loginAs(w.outsider.id);
    expect((await createForm(body)).status).toBe(404);
    await loginAs(w.owner.id);
    expect((await createForm(body)).status).toBe(201);
  });

  it("the template is checked: the money fields must be there with their types, the currencies are the five names, the purpose is one of two", async () => {
    const w = await setup();
    await loginAs(w.admin.id);
    const good = expenseSchema({ boxes: BOXES, approvers: [w.lead.id] });
    const make = (schema: unknown) => createForm({ workspaceId: w.ws.id, name: "نموذج", schema });
    const without = (id: string) => ({ ...good, fields: good.fields.filter((f) => f.id !== id) });
    for (const id of ["amount", "currency", "box", "reason"]) {
      const res = await make(without(id));
      expect(res.status, id).toBe(422);
      expect(detailKey(res), id).toBe("approvals.f.purpose_fields");
    }
    // a money field of the wrong type, or one that is optional
    expect(detailKey(await make({ ...good, fields: good.fields.map((f) => (f.id === "amount" ? { ...f, type: "text", min: undefined, max: undefined } : f)) }))).toBe("approvals.f.purpose_fields");
    expect(detailKey(await make({ ...good, fields: good.fields.map((f) => (f.id === "amount" ? { ...f, required: false } : f)) }))).toBe("approvals.f.purpose_fields");
    // a currency list with a word that is not one of the five
    const odd = await make({ ...good, fields: good.fields.map((f) => (f.id === "currency" ? { ...f, options: ["دينار", "ذهب"] } : f)) });
    expect(odd.status).toBe(422);
    expect(detailKey(odd)).toBe("approvals.f.purpose_currency");
    expect(detailPath(odd)).toBe("fields");
    // an unknown purpose
    const unknown = await make({ ...good, purpose: "salary" });
    expect(detailKey(unknown)).toBe("approvals.f.purpose_invalid");
    expect(detailPath(unknown)).toBe("purpose");
    // a transfer needs both boxes
    const t = transferSchema({ boxes: BOXES, approvers: [w.lead.id] });
    expect(detailKey(await make({ ...t, fields: t.fields.filter((f) => f.id !== "to_box") }))).toBe("approvals.f.purpose_fields");
    expect((await make(t)).status).toBe(201);
    expect((await make(good)).status).toBe(201);
  });

  it("an edit writes the next version and keeps the purpose; it can never be dropped by an edit", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const form = (await readForm(family)).json?.["form"] as { version: number; schema: { purpose?: string; fields: unknown[]; approvers: string[] } };
    expect(form.schema.purpose).toBe("expense");
    const plain = await editForm(family, { name: "طلب مصروف", schema: { fields: form.schema.fields, approvers: form.schema.approvers }, baseVersion: form.version });
    expect(plain.status).toBe(422);
    expect(detailKey(plain)).toBe("approvals.f.purpose_locked");
    const same = await editForm(family, { name: "طلب مصروف (معدّل)", schema: form.schema, baseVersion: form.version });
    expect(same.status).toBe(200);
    expect(await db.formTemplate.count({ where: { familyId: family } })).toBe(2);
  });
});

describe("filling it: the amount goes to the request's own columns, never into the answers or the words", () => {
  it("12.5 dinars becomes 1250 minor units + JOD; the answers and the details carry no amount; the receipt is attached; the first approver is told", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    await loginAs(w.member.id);
    const receipt = await makeUpload(w.orgId, w.member.id, "فاتورة.png");
    const res = await ask(w, w.member, family, GOOD, [receipt.id]);
    expect(res.status).toBe(201);
    const id = approvalOf(res)["id"] as string;
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.amountMinor).toBe(1250);
    expect(row.currency).toBe("JOD");
    expect(row.status).toBe("PENDING");
    expect(row.answers).toEqual({ box: GOOD.box, reason: GOOD.reason });
    expect(row.details).toContain(GOOD.reason);
    expect(row.details).toContain(GOOD.box);
    expect(row.details).not.toMatch(/12|1250|دينار/);
    expect(await db.approvalAttachment.count({ where: { requestId: id } })).toBe(1);
    // the requester reads their own amount back
    expect(approvalOf(res)["amount"]).toEqual({ minor: 1250, currency: "JOD" });
    // the bell: the title and who, no amount anywhere
    const bells = await bell(w.lead.id, "approval_requested");
    expect(bells).toHaveLength(1);
    expect(`${bells[0]!.title} ${bells[0]!.body}`).not.toMatch(/1250|12\.5|دينار|JOD/);
    // the audit log: whether there is an amount, never the amount
    const logged = await db.auditLog.findFirstOrThrow({ where: { action: "approval.requested", target: id } });
    expect(logged.meta).toMatchObject({ hasAmount: true });
    expect(Object.keys(logged.meta as object).sort()).toEqual(["approverIds", "files", "formId", "hasAmount", "version"]);
  });

  it("refuses an amount that is not a positive number with two decimals at most, a currency outside the list, a box outside the list, and an empty reason", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const bad = async (over: Record<string, unknown>, key: string, path: string) => {
      const res = await ask(w, w.member, family, { ...GOOD, ...over });
      expect(res.status, key).toBe(422);
      expect(detailKey(res), key).toBe(key);
      expect(detailPath(res), key).toBe(path);
    };
    await bad({ amount: 12.345 }, "approvals.e.amount_invalid", "amount");
    await bad({ amount: 0 }, "approvals.f.number_low", "amount");
    await bad({ amount: -5 }, "approvals.f.number_low", "amount");
    await bad({ amount: "12.5" }, "approvals.f.answer_type", "amount");
    await bad({ amount: 2_000_000 }, "approvals.f.number_high", "amount");
    await bad({ currency: "ذهب" }, "approvals.f.choice_invalid", "currency");
    await bad({ box: "صندوق غير موجود" }, "approvals.f.choice_invalid", "box");
    await bad({ reason: "   " }, "approvals.f.answer_required", "reason");
    expect(await db.approvalRequest.count({ where: { orgId: w.orgId } })).toBe(0);
  });

  it("a guest fills nothing (403) and a stranger finds nothing (404)", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const guest = await ask(w, w.guest, family, GOOD);
    expect(guest.status).toBe(403);
    expect(messageOf(guest)).toBe("guest.no_access");
    expect((await ask(w, w.outsider, family, GOOD)).status).toBe(404);
  });

  it("«تحويل بين الصناديق»: both boxes are kept in the words, the same box twice is refused at the second box", async () => {
    const w = await setup();
    const family = await makeForm(w, "transfer", [w.lead.id]);
    const same = await ask(w, w.member, family, { ...TRANSFER, to_box: TRANSFER.from_box });
    expect(same.status).toBe(422);
    expect(detailKey(same)).toBe("approvals.f.same_box");
    expect(detailPath(same)).toBe("to_box");
    const res = await ask(w, w.member, family, TRANSFER);
    expect(res.status).toBe(201);
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalOf(res)["id"] as string } });
    expect([row.amountMinor, row.currency]).toEqual([4000, "JOD"]);
    expect(row.details).toContain(BOXES[0]!);
    expect(row.details).toContain(BOXES[1]!);
    expect(row.details).not.toMatch(/40|دينار/);
  });
});

describe("who sees the amount: prices.view or cash.view, cut on the server (and the receipt with it)", () => {
  it("the owner and a lead (prices.view by rank) see it; a member asked to approve sees the request, not the amount, not the receipt; cash.view gives it back", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.member2.id]);
    const receipt = await makeUpload(w.orgId, w.member.id, "فاتورة.png");
    const made = await ask(w, w.member, family, GOOD, [receipt.id]);
    const id = approvalOf(made)["id"] as string;

    // the blind approver
    await loginAs(w.member2.id);
    const blind = approvalOf(await read(id));
    expect(blind["amount"]).toBeNull();
    expect(blind["amountHidden"]).toBe(true);
    expect(blind["attachments"]).toEqual([]);
    expect(blind["title"]).toBe("طلب مصروف");
    expect(blind["details"]).toContain(GOOD.reason);
    expect(blind["you"]).toMatchObject({ canDecide: true });
    expect(JSON.stringify(blind)).not.toContain('"minor"');
    const waiting = (await list("?view=waiting")).json?.["approvals"] as Record<string, unknown>[];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!["amount"]).toBeNull();
    expect(waiting[0]!["amountHidden"]).toBe(true);
    // the file door says no to them too, but yes to the requester
    expect(await mayReadApprovalFile({ orgId: w.orgId, userId: w.member2.id, role: "MEMBER" }, receipt.id)).toBe(false);
    await expect(assertMayReadFile({ orgId: w.orgId, userId: w.member2.id, orgRole: "MEMBER" }, receipt.id)).rejects.toMatchObject({ message: "files.not_found" });
    expect(await mayReadApprovalFile({ orgId: w.orgId, userId: w.member.id, role: "MEMBER" }, receipt.id)).toBe(true);

    // the manager of the space holds prices.view by rank: he reads the amount; the owner too
    for (const who of [w.admin, w.owner]) {
      await loginAs(who.id);
      const seen = approvalOf(await read(id));
      expect(seen["amount"], who.name).toEqual({ minor: 1250, currency: "JOD" });
      expect(seen["amountHidden"], who.name).toBe(false);
    }
    // the person who asked reads their own
    await loginAs(w.member.id);
    expect(approvalOf(await read(id))["amount"]).toEqual({ minor: 1250, currency: "JOD" });

    // cash.view alone gives the amount and the receipt
    await grant(w.orgId, w.member2.id, { capabilities: ["cash.view"] });
    await loginAs(w.member2.id);
    const now = approvalOf(await read(id));
    expect(now["amount"]).toEqual({ minor: 1250, currency: "JOD" });
    expect((now["attachments"] as unknown[]).length).toBe(1);
    expect(await mayReadApprovalFile({ orgId: w.orgId, userId: w.member2.id, role: "MEMBER" }, receipt.id)).toBe(true);
    // ... and prices.view alone does too (the rank's own holders); taking both away hides it again
    await grant(w.orgId, w.member2.id, { capabilities: ["prices.view"] });
    expect(approvalOf(await read(id))["amount"]).toEqual({ minor: 1250, currency: "JOD" });
    await grant(w.orgId, w.member2.id, { capabilities: [] });
    expect(approvalOf(await read(id))["amount"]).toBeNull();
  });

  it("a space manager whose prices.view was taken away is cut like anybody else, and so is the owner's partner", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    // a lead holds prices.view by rank: named in the chain, he reads the amount
    await loginAs(w.lead.id);
    expect(approvalOf(await read(id))["amount"]).toEqual({ minor: 1250, currency: "JOD" });
    await grant(w.orgId, w.admin.id, { revokedCapabilities: ["prices.view"] });
    await loginAs(w.admin.id);
    const seen = approvalOf(await read(id));
    expect(seen["amount"]).toBeNull();
    expect(seen["amountHidden"]).toBe(true);
    await grant(w.orgId, w.lead.id, { revokedCapabilities: ["prices.view"] });
    await loginAs(w.lead.id);
    expect(approvalOf(await read(id))["amount"]).toBeNull();
  });

  it("an ordinary approval keeps the rule it always had (everybody in the space sees its amount): only the money forms are cut", async () => {
    const w = await setup();
    await loginAs(w.member.id);
    const made = await fetchCreate(w, w.member, [w.member2.id]);
    await loginAs(w.member2.id);
    const seen = approvalOf(await read(made));
    expect(seen["amount"]).toEqual({ minor: 25000, currency: "USD" });
    expect(seen["amountHidden"] ?? false).toBe(false);
  });

  it("the people who may not read the request get nothing: a guest 403, a stranger 404", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.guest.id);
    expect((await read(id)).status).toBe(403);
    await loginAs(w.outsider.id);
    expect((await read(id)).status).toBe(404);
    // a member of the space who is neither the requester nor in the chain nor a manager reads nothing
    await loginAs(w.member2.id);
    expect((await read(id)).status).toBe(404);
  });
});

async function fetchCreate(w: AWorld, as: { id: string }, approverIds: string[]): Promise<string> {
  await loginAs(as.id);
  const res = await create({ workspaceId: w.ws.id, title: "شراء جهاز", details: "جهاز جديد للمكتب", approverIds, amount: "250", currency: "USD" });
  if (res.status !== 201) throw new Error(`could not ask: ${res.status} ${res.text}`);
  return approvalOf(res)["id"] as string;
}

describe("the decision is made in the app and posted as a card into the space's «عام» topic, with no amount", () => {
  it("an approval posts one CARD from the approver: only a pointer and the outcome, a readable line without any amount, and the request stays the one decision", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    expect(await cardsOf(w)).toHaveLength(0);
    await loginAs(w.lead.id);
    expect((await decide(id, "APPROVE")).status).toBe(200);
    const cards = await cardsOf(w);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.authorId).toBe(w.lead.id);
    expect(card.kind).toBe("CARD");
    expect(card.card).toEqual({ type: "approval", requestId: id, outcome: "APPROVED", purpose: "expense" });
    expect(card.viaApp).toBeTruthy();
    expect(card.ackRequired).toBe(false);
    expect(card.body).toContain("طلب مصروف");
    expect(card.body).toContain("Member");
    expect(card.body).not.toMatch(/\d|دينار|JOD/);
    // the topic moved on, so it is read as new
    const topic = await db.conversation.findUniqueOrThrow({ where: { id: spaceTopicIdOf(w.ws.id, "general") }, select: { lastMessageAt: true } });
    expect(topic.lastMessageAt).not.toBeNull();
    // a second decision is refused and posts nothing more
    expect((await decide(id, "REJECT", "متأخر")).status).toBe(409);
    expect(await cardsOf(w)).toHaveLength(1);
  });

  it("a rejection posts its card too; «اطلب تعديل» posts none (it is not a decision yet); a chain of two posts only at the end", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id, w.admin.id]);
    const first = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.lead.id);
    expect((await decide(first, "APPROVE")).status).toBe(200);
    expect(await cardsOf(w)).toHaveLength(0);
    await loginAs(w.admin.id);
    expect((await decide(first, "REJECT", "المبلغ كبير")).status).toBe(200);
    const cards = await cardsOf(w);
    expect(cards).toHaveLength(1);
    expect((cards[0]!.card as { outcome: string }).outcome).toBe("REJECTED");
    expect(cards[0]!.body).not.toContain("المبلغ كبير");

    const second = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.lead.id);
    expect((await decide(second, "CHANGES", "أضف الفاتورة")).status).toBe(200);
    expect(await cardsOf(w)).toHaveLength(1);
  });

  it("a transfer is posted as a transfer; an ordinary approval posts no card at all", async () => {
    const w = await setup();
    const family = await makeForm(w, "transfer", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, TRANSFER))["id"] as string;
    await loginAs(w.lead.id);
    expect((await decide(id, "APPROVE")).status).toBe(200);
    const cards = await cardsOf(w);
    expect((cards[0]!.card as { purpose: string }).purpose).toBe("transfer");
    expect(cards[0]!.body).toContain("تحويل بين الصناديق");
    expect(cards[0]!.body).not.toMatch(/40|دينار/);
    const plain = await fetchCreate(w, w.member, [w.lead.id]);
    await loginAs(w.lead.id);
    expect((await decide(plain, "APPROVE")).status).toBe(200);
    expect(await cardsOf(w)).toHaveLength(1);
  });

  it("when the decider may not post in the topic (the owner who has not joined it) the card is written by the person who asked; with the switch OFF nothing is posted and the decision still stands", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.owner.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.owner.id);
    expect((await decide(id, "APPROVE")).status).toBe(200);
    const cards = await cardsOf(w);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.authorId).toBe(w.member.id);

    const off = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await setSettings(w.orgId, { expenseForms: false });
    await loginAs(w.owner.id);
    expect((await decide(off, "APPROVE")).status).toBe(200);
    expect(await cardsOf(w)).toHaveLength(1);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: off } })).status).toBe("APPROVED");
  });

  it("no topic of that space (or a closed one) is not an error: the decision stands and nothing is posted", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await db.conversation.update({ where: { id: spaceTopicIdOf(w.ws.id, "general") }, data: { closedAt: new Date() } });
    await loginAs(w.lead.id);
    expect((await decide(id, "APPROVE")).status).toBe(200);
    expect(await cardsOf(w)).toHaveLength(0);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });

  it("money is never approved by a chat message: the card carries no action and a text in the topic changes nothing", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: spaceTopicIdOf(w.ws.id, "general"), authorId: w.lead.id, body: "موافق" } });
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    // an approver who is not the named one, whatever they hold, cannot decide through the door either
    await loginAs(w.admin.id);
    expect((await decide(id, "APPROVE")).status).toBe(403);
  });
});

describe("sent back: the requester edits, the amount comes back into the boxes for them alone, and an earlier version's amount is as private as the current one", () => {
  it("the requester gets the questions with their own amount; a resubmit writes the new amount; the blind approver never sees an old one", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.member2.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.member2.id);
    expect((await decide(id, "CHANGES", "اكتب المبلغ بالدولار")).status).toBe(200);

    await loginAs(w.member.id);
    const mine = approvalOf(await read(id));
    expect(mine["formFill"].answers).toMatchObject({ amount: 12.5, currency: "دينار", box: GOOD.box, reason: GOOD.reason });
    const sent = await resubmit(id, { answers: { ...GOOD, amount: 20, currency: "دولار" } });
    expect(sent.status).toBe(200);
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect([row.amountMinor, row.currency, row.version, row.status]).toEqual([2000, "USD", 2, "PENDING"]);
    expect(row.answers).toEqual({ box: GOOD.box, reason: GOOD.reason });
    expect(row.details).not.toMatch(/20|دولار/);

    // the blind approver: no amount in the current version, none in the earlier one, no questions-with-answers
    await loginAs(w.member2.id);
    const blind = approvalOf(await read(id));
    expect(blind["amount"]).toBeNull();
    expect(blind["previous"]).toHaveLength(1);
    expect(blind["previous"][0].amountMinor).toBeNull();
    expect(blind["previous"][0].currency).toBeNull();
    expect(JSON.stringify(blind)).not.toMatch(/"(minor|amountMinor)":\d/);
    // the lead (prices.view) reads both
    await loginAs(w.admin.id);
    const admin = approvalOf(await read(id));
    expect(admin["amount"]).toEqual({ minor: 2000, currency: "USD" });
    expect(admin["previous"][0].amountMinor).toBe(1250);
  });

  it("a request of a money form cannot be resent through the plain boxes (title, details, amount): only through its answers", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.lead.id);
    await decide(id, "CHANGES", "ناقص");
    await loginAs(w.member.id);
    const plain = await resubmit(id, { title: "عنوان جديد", details: "المبلغ 99", amount: "99", currency: "USD" });
    expect(plain.status).toBe(422);
    expect(detailKey(plain)).toBe("approvals.f.money_answers");
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id } })).version).toBe(1);
  });

  it("only the requester is handed the answers; a resubmit that misses the money fields is refused with the box named", async () => {
    const w = await setup();
    const family = await makeForm(w, "expense", [w.lead.id]);
    const id = approvalOf(await ask(w, w.member, family, GOOD))["id"] as string;
    await loginAs(w.lead.id);
    await decide(id, "CHANGES", "ناقص");
    expect(approvalOf(await read(id))["formFill"]).toBeNull();
    await loginAs(w.member.id);
    const res = await resubmit(id, { answers: { box: GOOD.box, reason: GOOD.reason } });
    expect(res.status).toBe(422);
    expect(detailPath(res)).toBe("amount");
    expect(detailKey(res)).toBe("approvals.f.answer_required");
  });
});

describe("cash.view is wired (R12): offered as a switch, held by the owner by rank, handed out by name", () => {
  it("is in the wired list; penalties.view is not; only the owner holds it by rank", () => {
    expect(WIRED_CAPABILITIES).toContain("cash.view");
    expect(WIRED_CAPABILITIES).not.toContain("penalties.view");
    expect(can({ role: "OWNER", capabilities: [], revokedCapabilities: [], primaryOwner: true }, "cash.view")).toBe(true);
    for (const role of ["ADMIN", "LEAD", "MEMBER", "GUEST"] as const) expect(can({ role, capabilities: [], revokedCapabilities: [] }, "cash.view"), role).toBe(false);
    expect(can({ role: "MEMBER", capabilities: ["cash.view"], revokedCapabilities: [] }, "cash.view")).toBe(true);
    expect(can({ role: "GUEST", capabilities: ["cash.view"], revokedCapabilities: [] }, "cash.view")).toBe(false);
  });
});
