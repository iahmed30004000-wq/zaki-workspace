import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { attachItemsOf, attachTabsOf } from "@/lib/chat/v2/composer/attach-items";
import { sheetDragOffset, sheetDragOutcome } from "@/lib/chat/v2/composer/sheet-drag";
import { contactMessage, contactsOf } from "@/lib/chat/v2/composer/contact-message";
import { buildPollPayload, dragTargetIndex, emptyPollDraft, moveOption, pollRoomKey, pollRoomLeft, POLL_MAX_OPTIONS } from "@/lib/chat/poll-client";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { AR } from "@/lib/i18n/dict";
import { TgAttachPanel, type TgAttachPanelProps } from "@/components/chat/v2/composer/attach-sheet-tg";
import { TgPollForm, PollCreateButton } from "@/components/chat/v2/composer/poll-form-tg";
import { ContactList } from "@/components/chat/v2/composer/attach-contacts";
import { AttachCaptionBar, AttachTile } from "@/components/chat/v2/composer/attach-sheet";
import type { PendingFile } from "@/lib/chat/v2/composer/types";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const noop = () => undefined;

describe("the tabs of the phone's attach sheet", () => {
  it("المعرض · ملف · استفتاء · جهة اتصال, and the checklist the app already had; no location and no article", () => {
    expect(attachTabsOf({ canPoll: true, canChecklist: true })).toEqual(["media", "file", "poll", "contact", "checklist"]);
    expect(attachTabsOf({})).toEqual(["media", "file", "contact"]);
  });
  it("the older paperclip menu offers what it offered", () => {
    expect(attachItemsOf({ canPoll: true, canChecklist: true })).toEqual(["media", "file", "poll", "checklist"]);
  });
});

describe("dragging the sheet", () => {
  it("up from half becomes the full page; down from half closes it; a small move snaps back", () => {
    expect(sheetDragOutcome("half", -TG_MOTION.sheetExpandPx)).toBe("full");
    expect(sheetDragOutcome("half", -10)).toBe("half");
    expect(sheetDragOutcome("half", TG_MOTION.sheetClosePx)).toBe("close");
    expect(sheetDragOutcome("half", 40)).toBe("half");
  });
  it("down from the full page goes back to half, a long way down closes", () => {
    expect(sheetDragOutcome("full", TG_MOTION.sheetClosePx)).toBe("half");
    expect(sheetDragOutcome("full", TG_MOTION.sheetClosePx * 4)).toBe("close");
    expect(sheetDragOutcome("full", 20)).toBe("full");
    expect(sheetDragOutcome("full", -300)).toBe("full");
  });
  it("the sheet follows the finger, but a full page does not go higher", () => {
    expect(sheetDragOffset("half", -80)).toBe(-80);
    expect(sheetDragOffset("full", -80)).toBe(0);
    expect(sheetDragOffset("full", 50)).toBe(50);
  });
});

describe("the poll's options", () => {
  it("are reordered by their handle, within the list", () => {
    expect(moveOption(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveOption(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveOption(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveOption(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(dragTargetIndex(0, 100, 48, 4)).toBe(2);
    expect(dragTargetIndex(3, -999, 48, 4)).toBe(0);
    expect(dragTargetIndex(1, 10, 48, 4)).toBe(1);
    expect(dragTargetIndex(1, 10, 0, 4)).toBe(1);
  });
  it("the counter says how many more fit, in the right Arabic number", () => {
    expect(pollRoomLeft(emptyPollDraft())).toBe(POLL_MAX_OPTIONS - 2);
    expect(pollRoomKey(0)).toBe("tgsheets.poll.room.zero");
    expect(pollRoomKey(1)).toBe("tgsheets.poll.room.one");
    expect(pollRoomKey(2)).toBe("tgsheets.poll.room.two");
    expect(pollRoomKey(8)).toBe("tgsheets.poll.room.few");
    expect(pollRoomKey(11)).toBe("tgsheets.poll.room.many");
    expect(AR["tgsheets.poll.room.many"]).toBe("يمكنك إضافة {n} خيارًا إضافيًا.");
    expect(AR["tgsheets.poll.room.few"]).toContain("خيارات");
    expect(AR["tgsheets.poll.room.two"]).toContain("خيارين");
  });
  it("what is sent is what the server already stores: nothing new", () => {
    const body = buildPollPayload({ question: "متى؟", options: ["اليوم", "بكرا"], multiple: true, anonymous: false, closesInMinutes: 60 }, "k");
    expect(Object.keys(body.poll).sort()).toEqual(["closesInMinutes", "multiple", "options"]);
  });
});

describe("the poll form as the spec draws it", () => {
  const form = (over: Partial<ReturnType<typeof emptyPollDraft>> = {}) => renderToStaticMarkup(createElement(TgPollForm, { draft: { ...emptyPollDraft(), ...over }, onChange: noop, error: "", action: createElement(PollCreateButton, { disabled: true, busy: false, onCreate: noop }) }));
  it("«سؤال», «الخيارات» with a drag handle each, «إضافة خيار…», the counter and «الإعدادات»", () => {
    const html = form();
    for (const word of ["سؤال", "اطرح سؤالًا", "الخيارات", "إضافة خيار…", "الإعدادات", "يمكنك إضافة 8 خيارات إضافية."]) expect(html).toContain(word);
    expect(html.match(/data-poll-handle=/g)).toHaveLength(2);
    expect(html).not.toContain("data-poll-remove");
    expect(form({ options: ["a", "b", "c"] }).match(/data-poll-remove=/g)).toHaveLength(3);
  });
  it("switch rows only for the choices that exist: show voters (the opposite of anonymous), several answers, a duration", () => {
    const html = form();
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html).toMatch(/data-poll-switch="voters"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-poll-switch="voters"/);
    for (const word of ["عرض من صوّت", "السماح بإجابات متعددة", "تحديد المدة"]) expect(html).toContain(word);
    for (const word of ["إعادة التصويت", "ترتيب الخيارات", "الإجابة الصحيحة", "وصف"]) expect(html).not.toContain(word);
    expect(form({ anonymous: true })).toMatch(/aria-checked="false"[^>]*data-poll-switch="voters"/);
  });
  it("a duration shows its choices only while it is on; no room left hides «إضافة خيار»", () => {
    expect(form()).not.toContain("data-poll-closes");
    expect(form({ closesInMinutes: 60 }).match(/data-poll-closes=/g)).toHaveLength(4);
    const full = form({ options: Array.from({ length: POLL_MAX_OPTIONS }, (_, i) => `x${i}`) });
    expect(full).not.toContain("data-poll-add");
    expect(full).toContain(AR["tgsheets.poll.room.zero"]!);
  });
  it("«إنشاء» is dim until the draft is valid", () => {
    const button = (disabled: boolean) => renderToStaticMarkup(createElement(PollCreateButton, { disabled, busy: false, onCreate: noop }));
    expect(button(true)).toContain("disabled");
    expect(button(false)).not.toContain("disabled=");
    expect(button(false)).toContain("إنشاء");
  });
});

const image = (name: string): PendingFile => ({ file: new File(["x"], name, { type: "image/png" }), kind: "IMAGE", preview: `blob:${name}`, asFile: false });

function panel(over: Partial<TgAttachPanelProps>): string {
  return renderToStaticMarkup(
    createElement(TgAttachPanel, { parts: { Tile: AttachTile, CaptionBar: AttachCaptionBar }, tabs: ["media", "file", "poll", "contact", "checklist"], tab: "media", size: "half", files: [], busy: false, caption: "", canSend: false, onTab: noop, onBack: noop, onCaption: noop, onPick: noop, onRemove: noop, onSend: noop, onCamera: noop, ...over }),
  );
}

describe("the phone's attach sheet", () => {
  it("«المعرض»: a camera tile that opens the phone's camera through a file input", () => {
    const html = panel({});
    expect(html).toContain("data-attach-camera");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(html).toContain("فتح الكاميرا");
    expect(html).toContain("data-attach-gallery");
    expect(html).toContain("data-attach-handle");
  });
  it("the tabs sit at the bottom as a tab list with the chosen one marked", () => {
    const html = panel({ tab: "file" });
    expect(html).toContain('role="tablist"');
    for (const id of ["media", "file", "poll", "contact", "checklist"]) expect(html).toContain(`data-attach-tab="${id}"`);
    expect(html).toMatch(/aria-selected="true"[^>]*data-attach-tab="file"/);
    for (const word of ["المعرض", "ملف", "استفتاء", "جهة اتصال"]) expect(html).toContain(word);
    for (const word of ["موقع", "مقالة"]) expect(html).not.toContain(word);
  });
  it("picked files: the numbered grid keeps the camera first, with the caption and the send button", () => {
    const html = panel({ files: [image("a.png"), image("b.png")], canSend: true });
    expect(html.match(/data-attach-number=/g)).toHaveLength(2);
    expect(html.indexOf("data-attach-camera")).toBeLessThan(html.indexOf("data-attach-number"));
    expect(html).toContain("data-attach-caption");
    expect(html).toContain("data-attach-send");
  });
  it("the poll and contact tabs draw what they are handed, with no caption bar", () => {
    const html = panel({ tab: "poll", files: [image("a.png")], content: createElement("p", { "data-here": "" }, "x") });
    expect(html).toContain("data-here");
    expect(html).not.toContain("data-attach-caption");
  });
  it("dragged up it is the full page «استفتاء جديد»: a back arrow, the title and «إنشاء», without the tab bar", () => {
    const html = panel({ tab: "poll", size: "full", headerAction: createElement("button", { type: "button", "data-make": "" }, "إنشاء") });
    expect(html).toContain("استفتاء جديد");
    expect(html).toContain("data-attach-back");
    expect(html).toContain("data-make");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-attach-handle");
  });
  it("obeys «الانتقالات السلسة» and slides for as long as the spec says", () => {
    const css = read("src/components/chat/v2/tg-sheets.css");
    expect(css).toContain("var(--tg-sheet-ms");
    expect(css).toContain('html[data-fx-off~="transitions"]');
    expect(css).toContain("prefers-reduced-motion: no-preference");
    const sheet = read("src/components/chat/v2/composer/attach-sheet-tg.tsx");
    expect(sheet).toContain('effectOn("transitions")');
    expect(sheet).toContain('tgMotionVars(["sheetMs"])');
    // the shared timings of every other sheet are not touched
    expect(read("src/components/ui/overlay-motion.css")).toContain("animation: zk-sheet-up-in 260ms");
  });
  it("is drawn only on a phone with the switch on; otherwise the sheet of before", () => {
    const sheet = read("src/components/chat/v2/composer/attach-sheet.tsx");
    expect(sheet).toContain("useTgPhone()");
    expect(sheet).toContain("if (tg)");
  });
});

describe("«جهة اتصال»", () => {
  it("an ordinary text message with the name and a link to the person's profile page", () => {
    expect(contactMessage("سلمى", "https://w.example", "u 2")).toBe("👤 سلمى\nhttps://w.example/u/u%202");
  });
  it("reads the people of the directory, the nameless left out", () => {
    const people = contactsOf({ people: [{ userId: "u2", role: "MEMBER", user: { id: "u2", name: "سلمى", jobTitle: "مبيعات", avatarUrl: null } }, { userId: "u3" }] });
    expect(people).toEqual([{ userId: "u2", name: "سلمى", jobTitle: "مبيعات", role: "MEMBER", avatarUrl: null, lastSeenAt: null, verified: false }]);
    expect(contactsOf(null)).toEqual([]);
  });
  it("one person is picked, then sent with a button (never on the first tap)", () => {
    const props = { people: contactsOf({ people: [{ userId: "u2", role: "MEMBER", user: { id: "u2", name: "سلمى", jobTitle: null, avatarUrl: null } }] }), state: "ready" as const, query: "", onQuery: noop, onPickPerson: noop, onSendContact: noop, busy: false, error: "" };
    const none = renderToStaticMarkup(createElement(ContactList, { ...props, picked: null }));
    expect(none).toContain('data-contact="u2"');
    expect(none).not.toContain("data-contact-send");
    const one = renderToStaticMarkup(createElement(ContactList, { ...props, picked: "u2" }));
    expect(one).toContain("data-contact-send");
    expect(renderToStaticMarkup(createElement(ContactList, { ...props, state: "refused" as const, picked: null }))).toContain(AR["tgsheets.contact.refused"]!);
  });
});
