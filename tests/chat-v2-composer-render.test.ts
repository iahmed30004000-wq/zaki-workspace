import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AttachMenu } from "@/components/chat/v2/composer/attach-menu";
import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { DropOverlay, DropZones } from "@/components/chat/v2/composer/drop-overlay";
import { EmojiPanel, EmojiPopover } from "@/components/chat/v2/composer/emoji-panel";
import { PasteSendDialog } from "@/components/chat/v2/composer/paste-dialog";
import { RecordBar } from "@/components/chat/v2/composer/record-bar";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { ComposerHost } from "@/components/chat/v2/pane/seams/composer-host";
import { MenuHost } from "@/components/chat/v2/pane/seams/menu-host";
import { attachItemsOf } from "@/lib/chat/v2/composer/attach-items";
import { composerFaceOf } from "@/lib/chat/v2/composer/face";
import type { PendingFile } from "@/lib/chat/v2/composer/types";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C2.5 — the composer, drawn on the server: one render test per state (the microphone, send with text, send with an attachment, save while editing, the
 * recording bar, the reasons a person cannot post, «شارك بالمحادثة»), the pieces (emoji, the attach menu, the paste dialog, the drop zones), and the
 * two things Q1 put in the composer: the «/» menu's «⚡» button and the customer-data line.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const Menus = MenuHost as unknown as FunctionComponent<{ header: ConversationHeaderDto; members: never[]; children?: ReactNode }>;
const noop = () => undefined;

const inI18n = (node: ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));
function inPane(header: ConversationHeaderDto, node: ReactElement): string {
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Actions, { conversationId: header.id, jumpTo: noop, toNewest: noop }, createElement(Menus, { header, members: [] }, node)))),
  );
}
const host = (header: ConversationHeaderDto) => inPane(header, createElement(ComposerHost, { header, people: null }));

const png = (name = "a.png"): PendingFile => ({ file: new File(["x"], name, { type: "image/png" }), kind: "IMAGE", preview: null, asFile: false });

/** An engine by hand: the box as the surface needs it. */
function engine(over: Partial<SurfaceEngine> & { voiceOn?: boolean } = {}): SurfaceEngine {
  const { voiceOn = true, ...rest } = over;
  const body = rest.body ?? "";
  const files = rest.files ?? [];
  const face = rest.face ?? composerFaceOf({ text: body, fileCount: files.length, editing: false, voiceOn });
  return {
    body, files, busy: false, error: "", progress: [], voice: { mode: "idle" }, face, canSubmit: body.trim().length > 0 || files.length > 0, choices: [], pickAt: 0, setPick: noop, hint: null,
    textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
    onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: (async () => undefined) as never, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop,
    ...rest,
  } as SurfaceEngine;
}
const surface = (c: SurfaceEngine, over: { me?: { canPoll?: boolean; canRecall?: boolean }; reply?: MessageDto | null; editing?: MessageDto | null } = {}) =>
  inI18n(createElement(ComposerSurface, { c, me: over.me ?? {}, reply: over.reply ?? null, editing: over.editing ?? null, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop }));

describe("the composer's states", () => {
  it("empty: the microphone (no send button), with the box, the emoji button and the attach button", () => {
    const html = surface(engine());
    expect(html).toContain('data-composer-face="mic"');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain("<textarea");
    expect(html).toContain("data-emoji-toggle");
    expect(html).toContain("data-attach-menu");
    expect(html).toContain(AR["chat.f.record"]!);
  });

  it("with text: send (a submit button, enabled)", () => {
    const html = surface(engine({ body: "أهلا" }));
    expect(html).toContain('data-composer-face="send"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('data-composer-face="mic"');
    expect(html).not.toMatch(/data-composer-face="send"[^>]*disabled/);
  });

  it("with an attachment and no words: send, and the tray shows the file", () => {
    const html = surface(engine({ files: [png("صورة.png")] }));
    expect(html).toContain('data-composer-face="send"');
    expect(html).toContain("data-file-tray");
    expect(html).toContain("صورة.png");
  });

  it("while an edit is typed: save, with the edit bar and no attach button", () => {
    const html = surface(engine({ body: "نص قديم", face: "save" }), { editing: makeMessage({ mine: true, body: "نص قديم" }) });
    expect(html).toContain('data-composer-face="save"');
    expect(html).toContain("data-edit-bar");
    expect(html).toContain(AR["chatc.editing"]!);
    expect(html).not.toContain("data-attach-menu");
    expect(html).not.toContain("data-recall-button");
  });

  it("with voice notes off an empty box shows a disabled send, never a microphone", () => {
    const html = surface(engine({ voiceOn: false }));
    expect(html).toContain('data-composer-face="send"');
    expect(html).toMatch(/data-composer-face="send"[^>]*disabled=""|disabled=""[^>]*data-composer-face="send"/);
  });

  it("the reply bar: the quoted words and the ✕ that ends it", () => {
    const html = surface(engine(), { reply: makeMessage({ authorName: "سلمى", body: "وين الطلب؟" }) });
    expect(html).toContain("data-reply-bar");
    expect(html).toContain("سلمى");
    expect(html).toContain("وين الطلب؟");
    expect(html).toContain(AR["chatc.cancel_reply"]!);
  });

  it("recording: the bar replaces the box, with cancel, a timer and send; a locked take says so", () => {
    const html = surface(engine({ voice: { mode: "recording", elapsedMs: 4000, peaks: [10, 40, 80], hold: true, locked: false } }));
    expect(html).toContain('data-recording="recording"');
    expect(html).not.toContain("<textarea");
    expect(html).toContain(AR["chat.f.cancel_recording"]!);
    expect(html).toContain(AR["chatui.composer.record_hold_hint"]!);
    const locked = inI18n(createElement(RecordBar, { voice: { mode: "recording", elapsedMs: 4000, peaks: [], hold: false, locked: true }, error: "", onCancel: noop, onSend: noop }));
    expect(locked).toContain("data-locked");
    expect(locked).toContain(AR["chatui.composer.record_locked"]!);
  });

  it("an upload error is said, and a busy box says it is sending", () => {
    expect(surface(engine({ body: "x", error: "فشل الرفع" }))).toContain("فشل الرفع");
    expect(surface(engine({ body: "x", busy: true, canSubmit: false }))).toContain(AR["chatc.sending"]!);
  });
});

describe("the composer host: whether there is a composer, and what says why not", () => {
  it("a person who may post gets the new composer: the microphone first", () => {
    const html = host(makeHeader());
    expect(html).toContain('data-composer-host="composer"');
    expect(html).toContain('data-composer-face="mic"');
    expect(html).toContain("<textarea");
  });

  it("cannot post: today's reason line, no box (closed, muted, announcements, not allowed, the owner's silent reading)", () => {
    for (const [header, key] of [
      [makeHeader({ closed: true, me: { canPost: false } }), "chatc.bar.closed"],
      [makeHeader({ me: { canPost: false, muted: true } }), "chatc.bar.muted"],
      [makeHeader({ topicType: "ANNOUNCEMENTS", me: { canPost: false } }), "chatc.bar.announcements"],
      [makeHeader({ me: { canPost: false } }), "chatc.bar.denied"],
      [makeHeader({ me: { canPost: false, oversight: true } }), "chatc.bar.oversight"],
    ] as const) {
      const html = host(header);
      expect(html, key).toContain(AR[key]!);
      expect(html, key).not.toContain("<textarea");
      expect(html, key).not.toContain("data-composer-face");
    }
  });

  it("the owner may join: «شارك بالمحادثة», no box", () => {
    const html = host(makeHeader({ me: { canPost: false, canJoin: true, oversight: true } }));
    expect(html).toContain('data-composer-host="join"');
    expect(html).toContain(AR["chatc.join"]!);
    expect(html).not.toContain("<textarea");
  });

  it("the poll item only where the server says I may; never a checklist, a schedule or a silent send", () => {
    expect(attachItemsOf(makeHeader().me)).toEqual(["media", "file"]);
    expect(attachItemsOf({ canPoll: true })).toEqual(["media", "file", "poll"]);
    const html = surface(engine());
    for (const word of [AR["chatc.poll.menu"]!]) expect(html).not.toContain(word);
    expect(html).not.toContain("data-schedule");
    expect(html).not.toContain("data-silent");
    const trigger = inI18n(createElement(AttachMenu, { items: ["media", "file", "poll"], disabled: false, onPick: noop }));
    expect(trigger).toContain("data-attach-menu");
    expect(trigger).toContain(AR["chat.f.attach_menu"]!);
  });
});

describe("the emoji picker", () => {
  it("closed it draws nothing; open (a computer: a popover over the box) it has the search and the recent emojis", () => {
    expect(inI18n(createElement(EmojiPopover, { open: false, onClose: noop, recents: ["😀"], onPick: noop }))).toBe("");
    const html = inI18n(createElement(EmojiPopover, { open: true, onClose: noop, recents: ["😀", "👍"], onPick: noop }));
    expect(html).toContain("data-emoji-popover");
    expect(html).toContain("data-emoji-recents");
    expect(html).toContain("😀");
    expect(html).toContain(AR["chatui.composer.emoji_recent"]!);
    expect(html).toContain(AR["chatui.composer.emoji_search"]!);
  });

  it("no recents row until there is a recent emoji", () => {
    expect(inI18n(createElement(EmojiPanel, { recents: [], onPick: noop }))).not.toContain("data-emoji-recents");
  });
});

describe("paste and drop", () => {
  it("a pasted picture opens the send dialog: caption, «ابعتها كملف», send and cancel (nothing when there is no paste)", () => {
    const files = [new File(["x"], "paste.png", { type: "image/png" })];
    const html = inI18n(createElement(PasteSendDialog, { files, initialCaption: "تعليق", onSend: noop, onCancel: noop, portal: false }));
    expect(html).toContain("data-paste-dialog");
    expect(html).toContain(AR["chatui.composer.paste_title"]!);
    expect(html).toContain(AR["chatui.composer.paste_caption"]!);
    expect(html).toContain(AR["chatui.composer.paste_as_file"]!);
    expect(html).toContain('role="switch"');
    expect(html).toContain("data-paste-send");
    expect(html).toContain(AR["chatc.cancel"]!);
    expect(html).toContain("تعليق");
    expect(inI18n(createElement(PasteSendDialog, { files: null, initialCaption: "", onSend: noop, onCancel: noop, portal: false }))).not.toContain("data-paste-dialog");
  });

  it("dropping files on the pane shows two zones: «ابعت كصور» and «ابعت كملفات»", () => {
    const html = inI18n(createElement(DropZones, { hover: "media" }));
    expect(html).toContain("data-drop-overlay");
    expect(html).toContain('data-drop-zone="media"');
    expect(html).toContain('data-drop-zone="files"');
    expect(html).toContain(AR["chatui.composer.drop_images"]!);
    expect(html).toContain(AR["chatui.composer.drop_files"]!);
    expect(html.indexOf("data-hover")).toBeGreaterThan(html.indexOf('data-drop-zone="media"'));
  });

  it("with no drag the overlay draws no zone (only its hidden marker)", () => {
    const html = inI18n(createElement(DropOverlay, { enabled: true, onDropFiles: noop }));
    expect(html).not.toContain("data-drop-overlay");
    expect(html).not.toContain(AR["chatui.composer.drop_images"]!);
  });
});

describe("what Q1 put in the composer", () => {
  it("«/» and its «⚡» button: only where the server says I may recall (`me.canRecall`), never while editing", () => {
    const on = surface(engine(), { me: { canRecall: true } });
    expect(on).toContain("data-recall-button");
    expect(on).toContain("⚡");
    expect(on).toContain(AR["recall.menu"]!);
    expect(surface(engine())).not.toContain("data-recall-button");
    expect(surface(engine({ body: "x", face: "save" }), { me: { canRecall: true }, editing: makeMessage({ mine: true }) })).not.toContain("data-recall-button");
  });

  it("the customer-data hint line under the box, with the same words as under a sent message; nothing without a hint", () => {
    const template = surface(engine({ body: "الاسم", hint: "template" }));
    expect(template).toContain("data-customer-hint");
    expect(template).toContain(AR["hints.template"]!);
    expect(template).toContain(AR["hints.template_fix"]!);
    const phone = surface(engine({ body: "0791234567", hint: "phone" }));
    expect(phone).toContain(AR["hints.phone"]!);
    expect(surface(engine({ body: "أهلا" }))).not.toContain("data-customer-hint");
  });

  it("the «/» menu's dialog is reachable from the host for a person who may recall (the dialog itself is Q1.3's, unchanged)", () => {
    const html = host(makeHeader({ me: { canRecall: true, recallKinds: ["product", "reply"] } }));
    expect(html).toContain("data-recall-button");
    expect(host(makeHeader())).not.toContain("data-recall-button");
  });
});
