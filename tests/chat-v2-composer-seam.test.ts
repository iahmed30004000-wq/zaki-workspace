import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C2.5 — how the new composer is wired, pinned by reading the source (the way `chat-v2-pane-seams` pins the pane): the old composer is untouched and still
 * exported, the new one adds NO server door, only a plain text is optimistic, the clientId keeps a retry from sending twice, and the drop zones live in the pane
 * root without a file of the pane knowing it.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}
const composerFiles = [...walk(path.join(ROOT, "src/components/chat/v2/composer")), ...walk(path.join(ROOT, "src/lib/chat/v2/composer"))];
const engine = read("src/lib/chat/v2/composer/use-composer.ts");
const host = read("src/components/chat/v2/pane/seams/composer-host.tsx");

describe("the old composer is untouched (the old screen and the quick chat)", () => {
  const old = read("src/components/chat/composer/chat-composer.tsx");
  it("keeps every export the old screen, the pane and the tests import", () => {
    expect(old).toContain("export function ChatComposer(");
    expect(old).toContain("export interface OutboxRestore");
    expect(old).toContain("export const HOLD_CANCEL_PX = 80;");
  });
  it("the old screen and the quick chat still draw ChatComposer, and nothing of the new composer is imported by them", () => {
    for (const file of walk(path.join(ROOT, "src")).filter((f) => !f.startsWith("src/components/chat/v2/") && !f.startsWith("src/lib/chat/v2/"))) {
      expect(read(file), file).not.toContain("chat/v2/composer/");
    }
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain("<ChatComposer");
  });
});

describe("the new composer adds no door", () => {
  it("the only addresses it names are the old composer's (the upload, a message's own edit, the send path) and the scheduled-message doors of C3c.3 (the conversation's own list, one row's edit, send-now and delete)", () => {
    const doors = new Set<string>();
    for (const file of composerFiles) for (const m of read(file).matchAll(/["'`](\/api\/[^"'`${]*)/g)) doors.add(m[1]!.replace(/\/$/, ""));
    // «جهة اتصال» of the phone's attach sheet READS the contacts screen's own directory door (it existed; nothing new is added on the server)
    expect([...doors].sort()).toEqual(["/api/chat/conversations", "/api/chat/directory?scope=company", "/api/chat/messages", "/api/chat/scheduled", "/api/chat/uploads"]);
    // the send itself goes through the existing helper, never a hand-made fetch of the messages door
    expect(engine).toContain("postChatMessage(");
    expect(engine).not.toMatch(/fetch\(`?["']?\/api\/chat\/conversations/);
  });
  it("no schema, no server file and no migration is part of it", () => {
    for (const file of composerFiles) expect(file, file).toMatch(/^src\/(components|lib)\/chat\/v2\/composer\//);
    for (const file of composerFiles) expect(read(file), file).not.toMatch(/from "@\/server\/(?!chat\/dto")/);
  });
});

describe("sending", () => {
  it("only a plain text with no file is optimistic, and only with the cache's QueryClient AND an outbox", () => {
    expect(engine).toContain("if (optimistic && outbox && draftOn && !tray.length) {");
    expect(engine.indexOf("startOptimisticSend(")).toBeLessThan(engine.indexOf("await postMessage("));
  });
  it("a voice note and an edit never take the optimistic path, and a voice note is never queued", () => {
    const voice = engine.slice(engine.indexOf("async function sendVoice"), engine.indexOf("// Esc throws a recording away"));
    expect(voice).not.toContain("startOptimisticSend");
    expect(voice).toContain("voice: true }, false)");
    expect(engine).toMatch(/if \(editing\) return void saveEdit\(\);/);
  });
  it("the effect is keyed on the QueryClient, so a parent that passes `{ qc }` inline does not re-subscribe on every render", () => {
    expect(engine).toContain("const optimisticQc = optimistic?.qc ?? null;");
    expect(engine).toContain("}, [optimisticQc, outbox, conversationId]);");
  });
  it("the clientId is renewed only when what is sent changes (so a retry is the same send to the server)", () => {
    // renewed by: a typed change, a file added or removed, a mention, an emoji, a restore, and after a send — never by a failed send
    expect(engine.match(/setClientId\(messageClientId\(\)\)/g)!.length).toBeGreaterThanOrEqual(8);
    const from = engine.indexOf("} catch (e) {\n      setError(failText(e, \"chatc.upload_failed\"))");
    const to = engine.indexOf("function submit(");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(engine.slice(from, to)).not.toContain("setClientId");
  });
  it("«ابعتها كملف» sends the bytes as they are: declared a plain file and never compressed", () => {
    expect(engine).toContain('if (item.kind === "IMAGE" && !item.asFile) {');
    expect(engine).toContain('createChatUploadFormData(upload, item.asFile ? "FILE" : item.kind)');
  });
  it("the draft is the old store (the list's «مسودة:» reads it): its key is not changed", () => {
    expect(engine).toContain('from "@/lib/chat/composer-draft"');
    expect(read("src/lib/chat/composer-draft.ts")).toContain('COMPOSER_DRAFT_PREFIX = "zaki.chat-draft.v1."');
  });
});

describe("the keyboard", () => {
  it("Esc ends a reply or an edit, «↑» in an empty box asks the host for my last message, Enter sends and Shift+Enter is a new line", () => {
    expect(engine).toContain('if (event.key === "Escape" && !composing) {');
    expect(engine).toContain("if (editing) { event.preventDefault(); onCancelEdit(); return; }");
    expect(engine).toContain("if (reply) { event.preventDefault(); onCancelReply(); return; }");
    expect(engine).toContain("arrowUpEdits({");
    expect(engine).toContain("enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: composing })");
  });
  it("the host reads the cache once per key press (it never subscribes to the messages) and starts the edit through the pane's commands", () => {
    expect(host).toContain("lastEditableOf(newestMessagesOf(qc, conversationId) ?? [], canPost)");
    expect(host).toContain("commands.startEdit(message)");
    expect(host).not.toContain("useChatMessages");
    expect(read("src/lib/chat/v2/composer/edit-last.ts")).toContain('messageMenuItems.find((item) => item.id === "edit")');
  });
});

describe("the host and the pane root", () => {
  it("still passes what C2.4 and C1.8 pinned: the optimistic bubble, the outbox, the restore, the edit state, composerBarOf", () => {
    for (const piece of ["<ChatComposerV2", "optimistic={{ qc }}", "outbox={outbox}", "restore={a.restore}", "editing={a.editing}", "composerBarOf(", "useOutbox(header.me.id, outboxOn)"]) expect(host).toContain(piece);
  });
  it("the drop zones are drawn INTO the pane root, and the pane's files do not know the composer's", () => {
    const overlay = read("src/components/chat/v2/composer/drop-overlay.tsx");
    expect(overlay).toContain('closest<HTMLElement>("[data-chat-pane-root]")');
    expect(overlay).toContain("createPortal(");
    for (const file of walk(path.join(ROOT, "src/components/chat/v2/pane")).filter((f) => !f.endsWith("seams/composer-host.tsx"))) {
      expect(read(file), file).not.toContain("v2/composer/");
    }
  });
  it("the emoji data comes from frimousse (already a dependency); no second picker, no new package", () => {
    expect(read("src/components/chat/v2/composer/emoji-panel.tsx")).toContain('from "frimousse"');
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["frimousse"]).toBeTruthy();
  });
});

describe("the review of C2.5 (source pins; each was red before the fix)", () => {
  const overlay = read("src/components/chat/v2/composer/drop-overlay.tsx");
  const panel = read("src/components/chat/v2/composer/emoji-panel.tsx");
  it("a paste that adds to the tray keeps what is there, and the send uses the id it renewed (not the stale one)", () => {
    expect(engine).toContain("const tray = [...filesRef.current, ...added];");
    expect(engine).toContain("async function sendNow(text: string, tray: PendingFile[], id: string = clientId)");
    expect(engine).toContain("void sendNow(caption, tray, id);");
    expect(engine).toMatch(/clientId: id\b/);
  });
  it("a paste or a send while busy changes nothing, and an edit is not sent twice", () => {
    expect(engine).toContain("if (!pasted || busy) return;");
    expect(engine).toMatch(/async function saveEdit\(\) \{\n    if \(busy \|\| !editing \|\| !body\.trim\(\)\) return;/);
  });
  it("Enter sends a file with no caption too (the same rule as the round button)", () => {
    expect(engine).toContain("if (canSubmitNow({ text: body, fileCount: files.length, editing: editing !== null, voiceOn, busy })) event.currentTarget.form?.requestSubmit();");
  });
  it("the hold follows ONE pointer, a second pointer never starts another recorder, and a stuck touch never eats a keyboard click", () => {
    expect(engine).toContain("if (releaseHold.current) return;");
    expect(engine).toContain("if (e.pointerId !== pointerId) return;");
    expect(engine).toContain("if (Date.now() - lastTouchAt.current < 800) return;");
    expect(engine).not.toContain('lastPointer.current = "mouse"');
  });
  it("a drag of files over a pane that is busy is still not the browser's (it would open the file and leave the page): the listeners stay, only the zones go", () => {
    expect(overlay).toContain("const enabledRef = React.useRef(enabled);");
    // the drag is claimed (preventDefault) BEFORE the «are the zones wanted» check
    expect(overlay.indexOf("event.preventDefault();\n      if (!enabledRef.current) return;")).toBeGreaterThan(0);
    expect(overlay).toContain("}, [root]);");
  });
  it("the emoji data is read from the package, never from a third-party address", () => {
    expect(panel).toContain("resolveEmojiData={resolveBundledEmojiData}");
    expect(panel).not.toMatch(/jsdelivr|unpkg|emojibaseUrl/);
    expect(read("src/lib/chat/v2/composer/emoji-data.ts")).toContain('import("emojibase-data/en/data.json")');
  });
  it("an error under the box is Arabic: the old rule, minus the raw English of a failed fetch", () => {
    expect(engine).toContain('from "@/lib/chat/v2/composer/fail-text"');
    expect(engine).toContain("failMessageOf(e, fallback, ct)");
    expect(engine).not.toContain('key.startsWith("chat.")');
  });
});
