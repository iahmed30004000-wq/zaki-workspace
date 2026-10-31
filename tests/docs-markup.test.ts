import { describe, expect, it } from "vitest";
import { LIMITS, cleanContent, excerptOf, mentionedIds, parseDoc, plainText, safeHref } from "@/lib/docs/markup";
import { decideDocSave, shouldSnapshot, SNAPSHOT_GAP_MS } from "@/lib/docs/versions";
import { applyEdit, mentionContext, pickMention } from "@/lib/docs/edit";

/**
 * «المستندات»: the little markup of a document (headings, bullets, bold, links, @names) is parsed into a tree the screen draws
 * with its own elements, never as HTML, so a document can say anything and run nothing.
 */

describe("parseDoc", () => {
  it("reads headings, bullets, numbered lines and paragraphs", () => {
    const blocks = parseDoc("# عنوان\n## فرعي\n### أصغر\nنص عادي\nسطر ثاني\n\n- أول\n- ثاني\n\n1. واحد\n2. اثنين", []);
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "h2", "h3", "p", "ul", "ol"]);
    const list = blocks[4];
    expect(list && list.kind === "ul" ? list.items.length : 0).toBe(2);
  });

  it("bold and links become nodes; a link with an unsafe address is plain text, not a link", () => {
    const [block] = parseDoc("هذا **مهم** و[موقعنا](https://example.com/x) و[خبيث](javascript:alert(1))", []);
    expect(block?.kind).toBe("p");
    const inline = block && block.kind === "p" ? block.inline : [];
    expect(inline.some((n) => n.kind === "bold")).toBe(true);
    const links = inline.filter((n) => n.kind === "link");
    expect(links).toEqual([{ kind: "link", href: "https://example.com/x", text: "موقعنا" }]);
    expect(JSON.stringify(inline)).toContain("javascript:alert(1)"); // shown as words, never as an address
  });

  it("an @name that is a person of the space is a mention; any other @word stays text", () => {
    const [block] = parseDoc("يا @أحمد علي شوف هاد و@غريب", ["أحمد علي"]);
    const inline = block && block.kind === "p" ? block.inline : [];
    expect(inline.filter((n) => n.kind === "mention")).toEqual([{ kind: "mention", text: "@أحمد علي" }]);
  });

  it("HTML is just text", () => {
    const [block] = parseDoc("<script>alert(1)</script> <img src=x onerror=alert(1)>", []);
    expect(block).toEqual({ kind: "p", inline: [{ kind: "text", text: "<script>alert(1)</script> <img src=x onerror=alert(1)>" }] });
  });
});

describe("safeHref", () => {
  it("lets https, http and mailto through and nothing else", () => {
    expect(safeHref("https://a.b/c?d=1")).toBe("https://a.b/c?d=1");
    expect(safeHref("http://a.b")).toBe("http://a.b/");
    expect(safeHref("mailto:x@y.com")).toBe("mailto:x@y.com");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "/relative", "ftp://x", " javascript:alert(1)", "https://", "https://a b"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("plainText and excerptOf", () => {
  it("strips the markup so a list shows words, not symbols", () => {
    expect(plainText("# عنوان\n- **أول** و[رابط](https://x.y)\n1. ثاني")).toBe("عنوان أول ورابط ثاني");
    expect(excerptOf("# " + "ب".repeat(300), 20)).toBe("ب".repeat(20) + "…");
    expect(excerptOf("قصير", 20)).toBe("قصير");
  });
});

describe("cleanContent", () => {
  it("keeps one kind of line break, drops control characters, and refuses nothing it can fix", () => {
    expect(cleanContent("a\r\nb\rc\u0000d\u0007e\tf")).toBe("a\nb\ncde\tf");
    expect(LIMITS.content).toBeGreaterThan(10_000);
  });
});

describe("mentionedIds", () => {
  const people = [
    { id: "u1", name: "أحمد" },
    { id: "u2", name: "أحمد علي" },
    { id: "u3", name: "سارة" },
  ];
  it("finds the people named as whole words, longest name first, once each", () => {
    expect(mentionedIds("@أحمد علي و @سارة و @سارة", people).sort()).toEqual(["u2", "u3"]);
    expect(mentionedIds("@أحمد، شوف", people)).toEqual(["u1"]);
    expect(mentionedIds("mail@سارة", people)).toEqual([]);
    expect(mentionedIds("@أحمدx", people)).toEqual([]);
  });
});

describe("versions", () => {
  it("a save that changes nothing is a no-op; a stale base is a conflict; no base (an old client) applies", () => {
    expect(decideDocSave({ baseVersion: 3, currentVersion: 3, changed: [] }).kind).toBe("noop");
    expect(decideDocSave({ baseVersion: 3, currentVersion: 3, changed: ["content"] }).kind).toBe("apply");
    expect(decideDocSave({ baseVersion: 2, currentVersion: 3, changed: ["content"] }).kind).toBe("conflict");
    expect(decideDocSave({ baseVersion: undefined, currentVersion: 3, changed: ["title"] }).kind).toBe("apply");
  });

  it("a run of quick saves by the same person is ONE history row; another person, a pause or a restore always writes one", () => {
    const t0 = new Date("2026-11-04T10:00:00Z");
    const soon = new Date(t0.getTime() + 10_000);
    const late = new Date(t0.getTime() + SNAPSHOT_GAP_MS + 1);
    expect(shouldSnapshot({ lastEditorId: "a", editorId: "a", lastSavedAt: t0, now: soon, cause: "EDIT" })).toBe(false);
    expect(shouldSnapshot({ lastEditorId: "a", editorId: "b", lastSavedAt: t0, now: soon, cause: "EDIT" })).toBe(true);
    expect(shouldSnapshot({ lastEditorId: "a", editorId: "a", lastSavedAt: t0, now: late, cause: "EDIT" })).toBe(true);
    expect(shouldSnapshot({ lastEditorId: "a", editorId: "a", lastSavedAt: t0, now: soon, cause: "RESTORE" })).toBe(true);
    expect(shouldSnapshot({ lastEditorId: null, editorId: "a", lastSavedAt: t0, now: soon, cause: "EDIT" })).toBe(true);
  });
});

describe("the editor's toolbar helpers", () => {
  it("bold wraps the selection (and unwraps it again)", () => {
    const first = applyEdit("اهلا بالعالم", { start: 5, end: 12 }, "bold");
    expect(first.value).toBe("اهلا **بالعالم**");
    const again = applyEdit(first.value, first.selection, "bold");
    expect(again.value).toBe("اهلا بالعالم");
    expect(applyEdit("x", { start: 1, end: 1 }, "bold").value).toBe("x****");
  });

  it("headings and bullets act on the whole line the cursor is in, and toggle", () => {
    expect(applyEdit("سطر", { start: 1, end: 1 }, "h1").value).toBe("# سطر");
    expect(applyEdit("# سطر", { start: 3, end: 3 }, "h1").value).toBe("سطر");
    expect(applyEdit("## سطر", { start: 3, end: 3 }, "h1").value).toBe("# سطر");
    expect(applyEdit("أ\nب\nج", { start: 3, end: 3 }, "ul").value).toBe("أ\n- ب\nج");
    expect(applyEdit("أ\n- ب\nج", { start: 4, end: 4 }, "ul").value).toBe("أ\nب\nج");
  });

  it("a link wraps the selection as the label and leaves the address to fill", () => {
    const out = applyEdit("شوف الموقع", { start: 4, end: 10 }, "link");
    expect(out.value).toBe("شوف [الموقع](https://)");
    expect(out.value.slice(out.selection.start, out.selection.end)).toBe("https://");
  });

  it("the @name picker works anywhere in the text, not only at its end (the chat's own finder, on the text before the cursor)", () => {
    const text = "قبل @سا بعد";
    const cursor = text.indexOf("@سا") + 3;
    expect(mentionContext(text, cursor)).toEqual({ query: "سا", start: text.indexOf("@سا") });
    expect(mentionContext("بدون منشن", 4)).toBeNull();
    const picked = pickMention(text, cursor, "سارة");
    expect(picked.value).toBe("قبل @سارة بعد");
    expect(picked.cursor).toBe("قبل @سارة ".length);
  });
});
