import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checklistCreateData,
  checklistInputSchema,
  checklistProgress,
  checklistRights,
  CHECKLIST_KIND,
  cleanChecklistItems,
  cleanChecklistText,
  MAX_CHECKLIST_ITEMS,
  mayEditItem,
  presentChecklist,
  type ChecklistRow,
  type ChecklistViewer,
} from "@/lib/chat/checklist";
import { buildChecklistPayload, checklistDraftProblem, checklistRequestOf, checklistStepsRequest, doneLineKey, emptyChecklistDraft, filledItems, isChecklistMessage } from "@/lib/chat/checklist-client";
import { menuFor, type MessageMenuContext } from "@/components/chat/message/message-menu-registry";
import type { MessageKind } from "@/server/chat/dto";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { rowPreview } from "@/lib/chat/row-preview";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import chatFeatures from "@/lib/i18n/ar.chat-features.json";
import { REALTIME_KINDS, isRealtimeKind } from "@/server/realtime/emit";

/**
 * C3c.1 — «قائمة مهام»: the pure parts (what is stored, who may do what, what a viewer is shown, what the screens send), the registries and the pins that
 * keep an item's words out of every reader of a message. The routes and the privacy rules are proven against a real database in `tests/db/chat-checklists.test.ts`.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const NOW = new Date("2026-11-20T10:20:00.000Z");
const row = (over: Partial<ChecklistRow> = {}): ChecklistRow => ({
  id: "cl1",
  othersCanAdd: false,
  othersCanTick: true,
  items: [
    { id: "i1", text: "كاسات", addedById: "author", doneById: "u2", doneAt: NOW, doneBy: { name: "سلمى" } },
    { id: "i2", text: "صحون", addedById: "author", doneById: null, doneAt: null, doneBy: null },
    { id: "i3", text: "عصير", addedById: "u2", doneById: null, doneAt: null, doneBy: null },
  ],
  ...over,
});
const viewer = (over: Partial<ChecklistViewer> = {}): ChecklistViewer => ({ userId: "u2", role: "MEMBER", oversight: false, isMember: true, canModerateHere: false, canPost: true, ...over });

describe("what is stored", () => {
  it("1 to 30 items of at most 200 characters; blanks dropped, spaces folded; anything else is refused whole", () => {
    expect(cleanChecklistItems(["  أ   ب ", "", "  ", "ج"])).toEqual(["أ ب", "ج"]);
    expect(cleanChecklistItems(["", " "])).toBeNull();
    expect(cleanChecklistItems([])).toBeNull();
    expect(cleanChecklistItems(["ب".repeat(200)])).toEqual(["ب".repeat(200)]);
    expect(cleanChecklistItems(["ب".repeat(201)])).toBeNull();
    expect(cleanChecklistItems(Array.from({ length: 30 }, (_, i) => `بند ${i}`))).toHaveLength(30);
    expect(cleanChecklistItems(Array.from({ length: 31 }, (_, i) => `بند ${i}`))).toBeNull();
    // 200 CHARACTERS, not code units: a hundred emoji are a hundred characters
    expect(cleanChecklistText("😀".repeat(200))).not.toBeNull();
    expect(cleanChecklistText("😀".repeat(201))).toBeNull();
    // invisible characters (zero width space, the right-to-left mark) are no words: such an item is a blank one
    expect(cleanChecklistText("\u200b")).toBeNull();
    expect(cleanChecklistText(" \u200f\u200b ")).toBeNull();
    expect(cleanChecklistItems(["\u200b", "أ"])).toEqual(["أ"]);
    // …but the joiner of a word (the Arabic and Persian letters use it) stays where it is inside one
    expect(cleanChecklistText("می\u200cخواهم")).toBe("می\u200cخواهم");
    // the same wording twice is allowed (a shopping list may repeat)
    expect(cleanChecklistItems(["حليب", "حليب"])).toEqual(["حليب", "حليب"]);
  });

  it("the send schema takes 1..30 strings and two optional flags, nothing else", () => {
    expect(checklistInputSchema.safeParse({ items: ["أ"] }).success).toBe(true);
    expect(checklistInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(checklistInputSchema.safeParse({ items: Array.from({ length: 31 }, () => "أ") }).success).toBe(false);
    expect(checklistInputSchema.safeParse({ items: ["أ"], othersCanAdd: true, othersCanTick: false }).success).toBe(true);
    expect(checklistInputSchema.safeParse({ items: ["أ"], othersCanAdd: "yes" }).success).toBe(false);
  });

  it("the nested write: positions in order, every item added by the author, the defaults (others tick, others do not add)", () => {
    const data = checklistCreateData({ items: ["x"] }, ["أ", "ب"], "author");
    expect(data.othersCanAdd).toBe(false);
    expect(data.othersCanTick).toBe(true);
    expect(data.items).toEqual({ create: [{ text: "أ", position: 0, addedById: "author" }, { text: "ب", position: 1, addedById: "author" }] });
    const set = checklistCreateData({ items: ["x"], othersCanAdd: true, othersCanTick: false }, ["أ"], "author");
    expect([set.othersCanAdd, set.othersCanTick]).toEqual([true, false]);
  });

  it("the kind is a text value (no enum), CHECKLIST", () => {
    expect(CHECKLIST_KIND).toBe("CHECKLIST");
    expect(read("prisma/schema.prisma")).toMatch(/kind\s+String\s+@default\("TEXT"\) \/\/ TEXT \| VOICE \| SYSTEM \| POLL \| CARD \| CHECKLIST/);
  });
});

describe("who may do what", () => {
  const list = { authorId: "author", othersCanAdd: false, othersCanTick: true };

  it("the author adds and ticks; others tick by default and add only when allowed", () => {
    expect(checklistRights(viewer({ userId: "author" }), list)).toMatchObject({ add: true, tick: true });
    expect(checklistRights(viewer(), list)).toMatchObject({ add: false, tick: true });
    expect(checklistRights(viewer(), { ...list, othersCanAdd: true })).toMatchObject({ add: true, tick: true });
    expect(checklistRights(viewer(), { ...list, othersCanTick: false })).toMatchObject({ add: false, tick: false });
    expect(checklistRights(viewer({ userId: "author" }), { ...list, othersCanTick: false })).toMatchObject({ tick: true });
  });

  it("a guest and a person who may not post do nothing; a viewer with no `canPost` (hand-made) gets no button", () => {
    expect(checklistRights(viewer({ role: "GUEST" }), { ...list, othersCanAdd: true })).toMatchObject({ add: false, tick: false, guest: true });
    expect(checklistRights(viewer({ canPost: false }), list)).toMatchObject({ add: false, tick: false });
    expect(checklistRights(viewer({ canPost: undefined }), list)).toMatchObject({ add: false, tick: false });
    expect(checklistRights(viewer({ userId: "author", role: "GUEST" }), list).add).toBe(false);
  });

  it("the owner in silent oversight (not a row of the conversation) ticks and adds nothing; after he joins he is one of the people", () => {
    const eye = viewer({ role: "OWNER", oversight: true, isMember: false });
    expect(checklistRights(eye, list)).toMatchObject({ silent: true, add: false, tick: false, moderate: false });
    expect(mayEditItem(eye, { authorId: "author" }, { addedById: "author" })).toBe(false);
    const joined = viewer({ role: "OWNER", oversight: true, isMember: true });
    expect(checklistRights(joined, list)).toMatchObject({ silent: false, tick: true });
    // a partner whose oversight was taken away is an ordinary person here
    expect(checklistRights(viewer({ role: "OWNER", oversight: false, isMember: false }), list)).toMatchObject({ silent: false, tick: true });
  });

  it("nothing is done on a deleted message, or with the company's switch off", () => {
    expect(checklistRights(viewer({ userId: "author" }), list, true)).toMatchObject({ add: false, tick: false });
    expect(checklistRights(viewer({ userId: "author", checklists: false }), list)).toMatchObject({ add: false, tick: false });
    expect(mayEditItem(viewer({ userId: "author", checklists: false }), { authorId: "author" }, { addedById: "author" })).toBe(false);
    expect(mayEditItem(viewer({ userId: "author" }), { authorId: "author" }, { addedById: "author" }, true)).toBe(false);
  });

  it("reword and remove: the item's author, the list's author, a moderator; nobody else", () => {
    const l = { authorId: "author" };
    expect(mayEditItem(viewer({ userId: "author" }), l, { addedById: "u2" })).toBe(true);
    expect(mayEditItem(viewer(), l, { addedById: "u2" })).toBe(true);
    expect(mayEditItem(viewer(), l, { addedById: "author" })).toBe(false);
    expect(mayEditItem(viewer({ userId: "mod", canModerateHere: true }), l, { addedById: "author" })).toBe(true);
    expect(mayEditItem(viewer({ role: "GUEST", userId: "author" }), l, { addedById: "author" })).toBe(false);
    // a person who may not write here (muted, a closed topic, a poster-only topic) changes no item either, and is drawn no pencil
    expect(mayEditItem(viewer({ userId: "author", canPost: false }), l, { addedById: "author" })).toBe(false);
    expect(mayEditItem(viewer({ userId: "mod", canModerateHere: true, canPost: false }), l, { addedById: "author" })).toBe(false);
    expect(presentChecklist(row(), viewer({ userId: "author", canPost: false }), "author", false).items.some((i) => i.canEdit)).toBe(false);
  });
});

describe("what a viewer is shown", () => {
  it("the items in order with their state, the progress, and the controls the rights allow", () => {
    const dto = presentChecklist(row(), viewer(), "author", false);
    expect(dto.items.map((i) => [i.text, i.done])).toEqual([["كاسات", true], ["صحون", false], ["عصير", false]]);
    expect([dto.done, dto.total]).toEqual([1, 3]);
    expect(dto).toMatchObject({ canAdd: false, canTick: true, max: 30, othersCanAdd: false, othersCanTick: true });
    expect(dto.items.map((i) => i.canEdit)).toEqual([false, false, true]); // only the item u2 added
    expect(dto.items[0]).toMatchObject({ doneByName: "سلمى", doneAt: NOW.toISOString() });
    expect(dto.items[1]!.doneAt).toBeUndefined();
  });

  it("a guest reads the ticks but never the name of who ticked; he has no control", () => {
    const dto = presentChecklist(row(), viewer({ role: "GUEST" }), "author", false);
    expect(dto.items[0]).toMatchObject({ done: true, doneAt: NOW.toISOString() });
    expect(dto.items[0]!.doneByName).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("سلمى");
    expect([dto.canAdd, dto.canTick, ...dto.items.map((i) => i.canEdit)].some(Boolean)).toBe(false);
  });

  it("the last free place is offered, a full list offers none", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: `بند ${i}`, addedById: "author", doneById: null, doneAt: null, doneBy: null }));
    expect(presentChecklist(row({ items: items(29) }), viewer({ userId: "author" }), "author", false).canAdd).toBe(true);
    expect(presentChecklist(row({ items: items(MAX_CHECKLIST_ITEMS) }), viewer({ userId: "author" }), "author", false).canAdd).toBe(false);
  });

  it("an item that was ticked by a person who is gone is still ticked, with no name", () => {
    const dto = presentChecklist(row({ items: [{ id: "i1", text: "أ", addedById: "a", doneById: null, doneAt: NOW, doneBy: null }] }), viewer(), "author", false);
    expect(dto.items[0]).toMatchObject({ done: true, doneByName: null });
    expect(doneLineKey(dto.items[0]!)).toBe("chatcl.done_at");
  });

  it("the progress counts the done items", () => {
    expect(checklistProgress([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("what the screens send", () => {
  it("the dialog's draft: a title and at least one item; blanks do not count; the two choices travel only when they differ from the defaults", () => {
    const draft = emptyChecklistDraft();
    expect(checklistDraftProblem(draft)).toBe("title");
    expect(checklistDraftProblem({ ...draft, title: "عنوان" })).toBe("items");
    expect(checklistDraftProblem({ ...draft, title: "عنوان", items: ["  ", ""] })).toBe("items");
    expect(checklistDraftProblem({ ...draft, title: "عنوان", items: ["أ"] })).toBeNull();
    expect(checklistDraftProblem({ ...draft, title: "ع".repeat(201), items: ["أ"] })).toBe("title");
    expect(checklistDraftProblem({ ...draft, title: "عنوان", items: ["ب".repeat(201)] })).toBe("too_long");
    expect(checklistDraftProblem({ ...draft, title: "عنوان", items: Array.from({ length: 31 }, (_, i) => `بند ${i}`) })).toBe("too_many");
    expect(filledItems({ ...draft, items: [" أ  ب ", "", "ج"] })).toEqual(["أ ب", "ج"]);
    expect(buildChecklistPayload({ title: " عنوان ", items: ["أ", "", "ب"], othersCanAdd: false, othersCanTick: true }, "c1")).toEqual({ body: "عنوان", clientId: "c1", checklist: { items: ["أ", "ب"] } });
    expect(buildChecklistPayload({ title: "ع", items: ["أ"], othersCanAdd: true, othersCanTick: false }, "c2").checklist).toEqual({ items: ["أ"], othersCanAdd: true, othersCanTick: false });
  });

  it("the bubble's four actions are four requests on the item routes", () => {
    expect(checklistRequestOf("m 1", { type: "add", text: "أ" })).toEqual({ url: "/api/chat/messages/m%201/checklist/items", method: "POST", body: { text: "أ" } });
    expect(checklistRequestOf("m1", { type: "tick", itemId: "i1", done: true })).toEqual({ url: "/api/chat/messages/m1/checklist/items/i1", method: "PUT", body: { done: true } });
    expect(checklistRequestOf("m1", { type: "edit", itemId: "i1", text: "ب" })).toEqual({ url: "/api/chat/messages/m1/checklist/items/i1", method: "PATCH", body: { text: "ب" } });
    expect(checklistRequestOf("m1", { type: "remove", itemId: "i1" })).toEqual({ url: "/api/chat/messages/m1/checklist/items/i1", method: "DELETE" });
  });

  it("the paperclip offers «قائمة مهام» only where the server says so, after the poll", () => {
    expect(attachItemsOf({})).toEqual(["media", "file"]);
    expect(attachItemsOf({ canPoll: true })).toEqual(["media", "file", "poll"]);
    expect(attachItemsOf({ canChecklist: true })).toEqual(["media", "file", "checklist"]);
    expect(attachItemsOf({ canPoll: true, canChecklist: true })).toEqual(["media", "file", "poll", "checklist"]);
  });

  it("the list's row says «☑️ العنوان (3/5)» with a count and «☑️ العنوان» without; a deleted list says «رسالة محذوفة»", () => {
    const base = { id: "c1", kind: "TOPIC", title: "t" } as never;
    const last = (over: Record<string, unknown>) => ({ ...(base as object), lastMessage: { id: "m", authorName: "سلمى", preview: "مشتريات", kind: "CHECKLIST", at: NOW.toISOString(), mine: false, ...over } }) as never;
    expect(rowPreview(last({ checklist: { done: 3, total: 5 } })).text).toBe("☑️ مشتريات (3/5)");
    expect(rowPreview(last({})).text).toBe("☑️ مشتريات");
    expect(rowPreview(last({ preview: null })).tone).toBe("deleted");
    expect(rowPreview(last({ preview: "**مشتريات**" })).text).toBe("☑️ مشتريات");
  });
});

describe("the registries", () => {
  it("`checklist.changed` is in the ONE list of realtime kinds, and sync carries it", () => {
    expect(REALTIME_KINDS).toContain("checklist.changed");
    expect(isRealtimeKind("checklist.changed")).toBe(true);
    expect(read("src/server/chat/sync.ts")).toMatch(/MESSAGE_EVENTS = new Set<RealtimeKind>\(\[[^\]]*"checklist\.changed"/);
  });

  it("the switch `chatChecklists`: OFF by default, in the chat group, and it needs the new screen", () => {
    expect(FEATURES).toContain("chatChecklists");
    expect(FEATURE_DEFAULTS.chatChecklists).toBe(false);
    expect(featureOn({}, "chatChecklists")).toBe(false);
    expect(featureOn({ features: { chatChecklists: true } }, "chatChecklists")).toBe(true);
    expect(FEATURE_META.chatChecklists).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(AR["features.chatChecklists.name"]).toBeTruthy();
    expect(AR["features.chatChecklists.hint"]).toContain("⚠️");
    expect(AR["features.chatChecklists.hint"]).toContain("🔧");
  });

  it("every word of the feature is in the dictionary: Arabic only, Western digits, no Latin letter", () => {
    const keys = Object.keys(chatFeatures).filter((k) => k.startsWith("chatcl.") || k.startsWith("chat.e.checklist_"));
    expect(keys.length).toBeGreaterThanOrEqual(35);
    for (const key of keys) {
      const value = (chatFeatures as Record<string, string>)[key]!;
      expect(AR[key], key).toBe(value);
      expect(value.replace(/{[^{}]+}/g, " "), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(value, key).not.toMatch(/[٠-٩]/);
      expect(value, key).not.toMatch(/ـاً/);
    }
    // the words the screens and the server use exist
    const used = new Set<string>();
    for (const file of ["src/components/chat/v2/bubble/bubble-checklist.tsx", "src/components/chat/v2/composer/checklist-dialog.tsx", "src/components/chat/v2/composer/attach-menu.tsx", "src/lib/chat/row-preview.ts", "src/lib/chat/checklist-client.ts", "src/server/chat/checklists.ts", "src/server/chat/messages.ts"]) {
      for (const m of read(file).matchAll(/["'`]((?:chatcl\.|chat\.e\.checklist_)[\w.]+)["'`]/g)) used.add(m[1]!);
    }
    for (const key of used) expect(AR[key], key).toBeTruthy();
    expect(used.size).toBeGreaterThanOrEqual(20);
  });
});

describe("the items' words stay out of every other reader of a message", () => {
  it("only the presenter turns a list into words: no other server file reads the items table or the include", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const readers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /chatChecklistItem|checklistInclude|\.checklist\b/.test(read(f)));
    const allowed = [
      "src/server/chat/checklists.ts", // the item routes
      "src/server/chat/messages.ts", // the send and the include
      "src/server/chat/redact.ts", // the presenter
      "src/lib/chat/checklist.ts", // the pure parts
      "src/server/chat/dto.ts",
      "src/components/chat/v2/bubble/bubble-body.tsx",
      "src/components/chat/v2/bubble/bubble-checklist.tsx",
      "src/lib/chat/row-preview.ts", // the count of the last message (never a word)
    ];
    expect(readers.filter((f) => !allowed.includes(f))).toEqual([]);
  });

  it("the send keeps a checklist out of the assistant, the semantic index and the ticket rules (they run for a TEXT message only)", () => {
    const src = read("src/server/chat/messages.ts");
    expect(src).toContain('if (kind === "TEXT") afterMessageSent(');
    expect(src).toContain('if (kind === "TEXT") queueSync(');
    expect(src).toMatch(/kind === "TEXT" && !internal\.card\) \{\s*after\.push\(\{ step: "auto_tickets"/);
  });

  it("every item route has zod, withApi and the service's policy; none builds its own access rule", () => {
    for (const file of ["src/app/api/chat/messages/[id]/checklist/items/route.ts", "src/app/api/chat/messages/[id]/checklist/items/[itemId]/route.ts", "src/app/api/chat/messages/[id]/checklist/steps/route.ts"]) {
      const src = read(file);
      expect(src, file).toContain("withApi(");
      expect(src, file).toContain("activeOrgCtx()");
      expect(src, file).not.toMatch(/role\s*===/);
    }
    const service = read("src/server/chat/checklists.ts");
    expect(service).toContain('assertFeatureOn(ctx.orgId, "chatChecklists")');
    expect(service).toContain("FOR UPDATE");
    expect(service).not.toMatch(/role === "OWNER"|orgRole === "OWNER"|isOwnerOf\(/);
  });

  it("the migration is additive: two new tables, nothing dropped, nothing altered", () => {
    const sql = read("prisma/migrations/20261126130000_chat_checklists/migration.sql");
    expect([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual(["ChatChecklist", "ChatChecklistItem"]);
    expect(sql).not.toMatch(/DROP |TRUNCATE|DELETE FROM|ALTER COLUMN|RENAME/);
    expect(sql).toContain('"othersCanAdd" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"othersCanTick" BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain('"text" VARCHAR(200) NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "ChatChecklist_messageId_key"');
    expect(sql).toContain('CREATE INDEX "ChatChecklistItem_checklistId_position_idx" ON "ChatChecklistItem"("checklistId", "position")');
    expect(sql).toMatch(/"ChatChecklist_messageId_fkey" FOREIGN KEY \("messageId"\) REFERENCES "ChatMessage"\("id"\) ON DELETE CASCADE/);
    // a released folder is frozen: this one is NOT in the pin list until it has been deployed
    expect(read("prisma/migrations/RELEASED.txt")).not.toContain("chat_checklists");
  });
});

/** The two gaps of the audit: the wire kind is a member of the union, and «اعمل منها مهمة» from the MENU (not only the list's own button) writes the steps. */
describe("a CHECKLIST message in the screens' unions and in the message menu", () => {
  it("MessageKind and the menu registry's kind both hold CHECKLIST (the wire value is CHECKLIST_KIND)", () => {
    const kind: MessageKind = CHECKLIST_KIND as MessageKind; // does not compile unless the union holds "CHECKLIST"
    expect(kind).toBe("CHECKLIST");
    expect(read("src/server/chat/dto.ts")).toMatch(/export type MessageKind = [^;]*"CHECKLIST"/);
    expect(read("src/components/chat/message/message-menu-registry.ts")).toMatch(/kind: "TEXT" \| "VOICE" \| "SYSTEM" \| "POLL" \| "CARD" \| "CHECKLIST";/);
  });

  it("the menu of a list: reply, copy, task and delete as for a text; no edit (the words are the title and the items are not editable as text), no forward and no save (a copy would carry no items: the server refuses both)", () => {
    const base: MessageMenuContext = { mine: true, deleted: false, kind: "CHECKLIST", hasText: true, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: false, oversight: false, canMakeWork: true, surface: "v2" };
    const ids = menuFor(base).map((a) => a.id);
    expect(ids).toContain("task");
    expect(ids).toContain("reply");
    expect(ids).toContain("delete");
    expect(ids).not.toContain("edit");
    expect(ids).not.toContain("forward");
    expect(menuFor({ ...base, canSaved: true }).map((a) => a.id)).not.toContain("saved");
    expect(menuFor({ ...base, kind: "TEXT", canSaved: true }).map((a) => a.id)).toEqual(expect.arrayContaining(["forward", "saved"]));
    // nobody who may not make work of a message is offered the task, a list or not
    expect(menuFor({ ...base, canMakeWork: false }).map((a) => a.id)).not.toContain("task");
  });

  it("the list's message is recognised by its wire kind, and the steps request is the one door's (taskId in the body)", () => {
    expect(isChecklistMessage({ kind: "CHECKLIST" })).toBe(true);
    expect(isChecklistMessage({ kind: "TEXT" })).toBe(false);
    expect(isChecklistMessage({})).toBe(false);
    expect(checklistStepsRequest("m 1", "t1")).toEqual({ url: "/api/chat/messages/m%201/checklist/steps", method: "POST", body: { taskId: "t1" } });
  });

  it("«اعمل منها مهمة» writes the steps from EVERY door: the dialog itself asks, the bubble and the menu host only say how it went", () => {
    const dialog = read("src/components/chat/message/make-work-dialog.tsx");
    // after the task of a list was made, the dialog (the one place both doors run) posts the steps, for a task only
    expect(dialog).toMatch(/kind === "task" && id && message && isChecklistMessage\(message\)/);
    expect(dialog).toContain("checklistStepsRequest(message.id, id)");
    expect(dialog).toContain("stepsCopied");
    // the menu host hands the dialog the WHOLE message (its kind decides), not a copy without it
    expect(read("src/components/chat/v2/pane/seams/menu-host.tsx")).toContain("setMaking({ message, kind: id })");
    expect(read("src/components/chat/v2/pane/seams/menu-host.tsx")).toContain("made.stepsCopied");
    // the bubble no longer asks for the steps on its own (that would be a second request: «steps exist», 403)
    const bubble = read("src/components/chat/v2/bubble/bubble-checklist.tsx");
    expect(bubble).not.toContain("/checklist/steps");
    expect(bubble).toContain("kind: message.kind");
    expect(bubble).toContain("made.stepsCopied");
  });
});
