import { describe, expect, it } from "vitest";
import { parseFormatting, stripFormatting, type Block, type Inline } from "@/lib/chat/format/parse";
import { findLinks, safeHref } from "@/lib/chat/format/links";
import { cleanMath } from "@/lib/chat/format/math";
import { buildChatPrompt, redactChatText, CHAT_SYSTEM_PROMPT } from "@/server/ai/redact-chat";

/**
 * C3b.1 — the ONE parser of the chat's text formatting (`src/lib/chat/format/parse.ts`): `**bold**`, `__italic__`, `~~strike~~`, `` `code` ``, a fenced block, `||spoiler||`,
 * `> quote` lines, `[text](https://…)` and bare links. The text stays text in `ChatMessage.body` (no schema). Every rule here is a pure function of the string, so a
 * browser is not needed: markers that do not pair stay plain, a link is only ever `https:` / `http:` / `mailto:` (or an in-app `/chat/…`, `/tasks/…` path), and nothing
 * in a body is ever treated as HTML.
 */

const text = (s: string): Inline => ({ t: "text", text: s });
/** the inline tokens of a one-paragraph body */
function inlineOf(body: string): Inline[] {
  const blocks = parseFormatting(body);
  expect(blocks).toHaveLength(1);
  const block = blocks[0] as Block;
  expect(block.t).toBe("text");
  return (block as Extract<Block, { t: "text" }>).inline;
}

describe("every marker", () => {
  it("**bold**, __italic__, ~~strike~~, ||spoiler||, `code`", () => {
    expect(inlineOf("a **عريض** b")).toEqual([text("a "), { t: "bold", children: [text("عريض")] }, text(" b")]);
    expect(inlineOf("__مائل__")).toEqual([{ t: "italic", children: [text("مائل")] }]);
    expect(inlineOf("~~مشطوب~~ x")).toEqual([{ t: "strike", children: [text("مشطوب")] }, text(" x")]);
    expect(inlineOf("||سر||")).toEqual([{ t: "spoiler", children: [text("سر")] }]);
    expect(inlineOf("run `npm test` now")).toEqual([text("run "), { t: "code", text: "npm test" }, text(" now")]);
  });

  it("a code span keeps its markers literally (nothing inside it is formatted or linked)", () => {
    expect(inlineOf("`**x** https://a.com`")).toEqual([{ t: "code", text: "**x** https://a.com" }]);
  });

  it("a fenced block is its own block, on one line or on many, and keeps its words as they are", () => {
    expect(parseFormatting("```كتلة```")).toEqual([{ t: "pre", text: "كتلة" }]);
    expect(parseFormatting("قبل\n```\nline1\n**line2**\n```\nبعد")).toEqual([
      { t: "text", inline: [text("قبل")] },
      { t: "pre", text: "line1\n**line2**" },
      { t: "text", inline: [text("بعد")] },
    ]);
  });

  it("an unclosed fence is plain text", () => {
    expect(parseFormatting("```never closed")).toEqual([{ t: "text", inline: [text("```never closed")] }]);
  });

  it("lines that start with «> » are a quote block; the words after it are a paragraph", () => {
    expect(parseFormatting("> سطر ١\n> سطر **٢**\nرد")).toEqual([
      { t: "quote", inline: [text("سطر ١\nسطر "), { t: "bold", children: [text("٢")] }] },
      { t: "text", inline: [text("رد")] },
    ]);
  });

  it("«>» without a space, or in the middle of a line, is not a quote", () => {
    expect(parseFormatting(">no space")).toEqual([{ t: "text", inline: [text(">no space")] }]);
    expect(parseFormatting("a > b")).toEqual([{ t: "text", inline: [text("a > b")] }]);
  });

  it("a plain body is ONE text token (the cheap path) and an empty body is nothing", () => {
    expect(parseFormatting("")).toEqual([]);
    expect(parseFormatting("مرحبا بالجميع 123")).toEqual([{ t: "text", inline: [text("مرحبا بالجميع 123")] }]);
  });
});

describe("nesting and mistakes", () => {
  it("markers nest", () => {
    expect(inlineOf("**a __b__ c**")).toEqual([{ t: "bold", children: [text("a "), { t: "italic", children: [text("b")] }, text(" c")] }]);
    expect(inlineOf("||~~x~~||")).toEqual([{ t: "spoiler", children: [{ t: "strike", children: [text("x")] }] }]);
  });

  it("an unclosed marker stays as typed", () => {
    expect(inlineOf("**never closed")).toEqual([text("**never closed")]);
    expect(inlineOf("a __b")).toEqual([text("a __b")]);
    expect(inlineOf("one ` tick")).toEqual([text("one ` tick")]);
  });

  it("markers next to spaces are not markers (a sum, a product, an «or»)", () => {
    expect(inlineOf("2 ** 3 ** 4")).toEqual([text("2 ** 3 ** 4")]);
    expect(inlineOf("a || b || c")).toEqual([text("a || b || c")]);
    expect(inlineOf("a ~~ b ~~ c")).toEqual([text("a ~~ b ~~ c")]);
  });

  it("an empty pair is plain", () => {
    expect(inlineOf("****")).toEqual([text("****")]);
    expect(inlineOf("____")).toEqual([text("____")]);
  });

  it("crossing markers never produce crossing elements", () => {
    const out = inlineOf("**a __b** c__");
    expect(out).toEqual([{ t: "bold", children: [text("a __b")] }, text(" c__")]);
  });

  it("a very deep nesting is cut, not recursed forever", () => {
    const body = "**__~~||" + "x" + "||~~__**";
    expect(() => parseFormatting(body)).not.toThrow();
    const deep = "**".repeat(200) + "x" + "**".repeat(200);
    expect(() => parseFormatting(deep)).not.toThrow();
  });
});

describe("RTL and LTR mixed", () => {
  it("Arabic and Latin words inside one marker stay one token each side", () => {
    expect(inlineOf("**الطلب ZK-2026-1234 جاهز**")).toEqual([{ t: "bold", children: [text("الطلب ZK-2026-1234 جاهز")] }]);
  });

  it("a marker closes after an Arabic word with a right-to-left mark in front of it", () => {
    expect(inlineOf("**كلمة\u200f**")).toEqual([{ t: "bold", children: [text("كلمة\u200f")] }]);
  });

  it("a Latin URL inside Arabic words is a link token between two text tokens", () => {
    const out = inlineOf("افتح https://example.com/a الآن");
    expect(out.map((t) => t.t)).toEqual(["text", "link", "text"]);
  });
});

describe("links", () => {
  it("[text](https://…) is a link with its label", () => {
    expect(inlineOf("[موقعنا](https://example.com/ar)")).toEqual([{ t: "link", href: "https://example.com/ar", internal: false, label: [text("موقعنا")] }]);
  });

  it("a bare https:// / http:// / mailto: / www. link is a link, without the punctuation that follows it", () => {
    const hrefs = (body: string) => findLinks(body).map((l) => l.href);
    expect(hrefs("see https://example.com/path?a=1&b=2.")).toEqual(["https://example.com/path?a=1&b=2"]);
    expect(hrefs("(http://example.com)")).toEqual(["http://example.com/"]);
    expect(hrefs("اكتب لـ mailto:team@example.com،")).toEqual(["mailto:team@example.com"]);
    expect(hrefs("www.example.com/x!")).toEqual(["https://www.example.com/x"]);
    expect(hrefs("https://en.wikipedia.org/wiki/Foo_(bar) ok")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(hrefs("**https://example.com**")).toEqual(["https://example.com/"]);
  });

  it("the link tokenizer reports where each link stands in the text (C3b.2 reuses it)", () => {
    const body = "x https://a.com/b y";
    const [link] = findLinks(body);
    expect(link).toMatchObject({ start: 2, end: 17, text: "https://a.com/b", href: "https://a.com/b" });
    expect(body.slice(link!.start, link!.end)).toBe(link!.text);
  });

  it("only https, http and mailto; everything else is NOT a link and shows as typed", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "file:///etc/passwd", "ftp://example.com", "//evil.com", "\u0001javascript:x"]) {
      expect(safeHref(bad), bad).toBeNull();
      const out = inlineOf(`[click](${bad})`);
      expect(out.every((t) => t.t === "text"), bad).toBe(true);
      expect(out.map((t) => (t as { text: string }).text).join("")).toBe(`[click](${bad})`);
    }
  });

  it("a link with a user name or password is refused (https://google.com@evil.com)", () => {
    expect(safeHref("https://google.com@evil.com/")).toBeNull();
    expect(safeHref("https://user:pw@example.com/")).toBeNull();
  });

  it("in-app paths /chat/… and /tasks/… are internal links; any other path, and «//host», are not", () => {
    expect(safeHref("/chat/abc123?m=xyz")).toEqual({ href: "/chat/abc123?m=xyz", internal: true });
    expect(safeHref("/tasks/t1")).toEqual({ href: "/tasks/t1", internal: true });
    expect(safeHref("/api/auth/signout")).toBeNull();
    expect(safeHref("/chat/../api/x")).toBeNull();
    expect(safeHref("/chat//evil.com")).toBeNull();
    expect(safeHref("/chat/\\evil.com")).toBeNull();
    expect(inlineOf("[المحادثة](/chat/c1)")).toEqual([{ t: "link", href: "/chat/c1", internal: true, label: [text("المحادثة")] }]);
  });

  it("a label that looks like another address shows the REAL address (no «google.com» that opens evil.com)", () => {
    const [link] = inlineOf("[https://bank.example](https://evil.example/login)");
    expect(link).toMatchObject({ t: "link", href: "https://evil.example/login", label: [text("https://evil.example/login")] });
    // the same host is fine: the label stays
    const [same] = inlineOf("[https://example.com/a](https://example.com/b)");
    expect(same).toMatchObject({ label: [text("https://example.com/a")] });
  });

  it("a link label may carry a marker, but never a second link", () => {
    const [link] = inlineOf("[**مهم**](https://example.com)");
    expect(link).toMatchObject({ t: "link", label: [{ t: "bold", children: [text("مهم")] }] });
  });

  it("markers inside the address are not markers", () => {
    expect(inlineOf("https://example.com/a__b__c/d")).toEqual([{ t: "link", href: "https://example.com/a__b__c/d", internal: false, label: [text("https://example.com/a__b__c/d")] }]);
  });
});

describe("injection attempts stay text", () => {
  it("<script>, an <img onerror> and entities are text tokens, byte for byte (React escapes them when drawn)", () => {
    for (const body of ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "&lt;b&gt;x&lt;/b&gt; &amp; &#60;", "<a href=\"javascript:alert(1)\">x</a>"]) {
      expect(parseFormatting(body)).toEqual([{ t: "text", inline: [text(body)] }]);
    }
  });

  it("a marker around markup keeps the markup as text inside the element", () => {
    expect(inlineOf("**<script>alert(1)</script>**")).toEqual([{ t: "bold", children: [text("<script>alert(1)</script>")] }]);
  });

  it("a link whose label is markup shows it as text", () => {
    const [link] = inlineOf("[<script>](https://example.com)");
    expect(link).toMatchObject({ t: "link", label: [text("<script>")] });
  });
});

describe("stripFormatting — the words without the markers, for every text-out path", () => {
  it("removes each marker and keeps the words", () => {
    expect(stripFormatting("a **b** __c__ ~~d~~ `e` f")).toBe("a b c d e f");
    expect(stripFormatting("```code **here**```")).toBe("code **here**");
    expect(stripFormatting("> مقتبس\nرد")).toBe("مقتبس\nرد");
    expect(stripFormatting("[الدليل](https://example.com/guide) والباقي")).toBe("الدليل والباقي");
  });

  it("a spoiler is hidden in a preview, and kept for a model call that is told to keep it", () => {
    expect(stripFormatting("الرقم ||1234|| سري")).toBe("الرقم ••• سري");
    expect(stripFormatting("الرقم ||1234|| سري", { spoilers: "keep" })).toBe("الرقم 1234 سري");
  });

  it("unclosed markers and a body without any marker come back untouched", () => {
    expect(stripFormatting("**never closed")).toBe("**never closed");
    expect(stripFormatting("سلام")).toBe("سلام");
  });

  it("a bare link stays in the words (the text is the address)", () => {
    expect(stripFormatting("افتح https://example.com/x الآن")).toBe("افتح https://example.com/x الآن");
  });

  it("math markup is dropped only when asked (previews ask, the model paths do not)", () => {
    expect(stripFormatting("\\( 2 \\times 3 \\)")).toBe("\\( 2 \\times 3 \\)");
    expect(stripFormatting("\\( 2 \\times 3 \\)", { math: true })).toBe("2 × 3");
  });

  it("is the same words as the parser's tokens (one source of truth)", () => {
    const body = "**x** [l](https://example.com) > not a quote ~~y~~ ||z||";
    expect(stripFormatting(body, { spoilers: "keep" })).toBe("x l > not a quote y z");
  });
});

describe("math markup the assistant sometimes printed", () => {
  it("\\( … \\), \\[ … \\] and \\frac{…}{…} become plain characters, without backslashes", () => {
    expect(cleanMath("الناتج \\( \\frac{1}{2} \\) تقريباً")).toBe("الناتج 1/2 تقريباً");
    expect(cleanMath("\\[ x^{2} + y_{1} \\]")).toBe("x^2 + y_1");
    expect(cleanMath("\\( a \\times b \\approx c \\)")).toBe("a × b ≈ c");
    expect(cleanMath("\\frac{a+b}{c}")).toBe("(a+b)/c");
    expect(cleanMath("\\text{المجموع} = 5")).toBe("المجموع = 5");
    expect(cleanMath("\\( \\sqrt{9} = 3 \\)")).toBe("√9 = 3");
  });

  it("a stray delimiter loses its backslash; a backslash anywhere else is left alone (a Windows path)", () => {
    expect(cleanMath("end \\)")).toBe("end ");
    expect(cleanMath("C:\\Users\\mko\\times.txt")).toBe("C:\\Users\\mko\\times.txt");
  });

  it("a text without a backslash is returned as it is", () => {
    const s = "no math here";
    expect(cleanMath(s)).toBe(s);
  });
});

describe("speed", () => {
  const mixed = Array.from({ length: 140 }, (_, i) => `**سطر ${i}** __مائل__ \`x${i}\` https://example.com/p/${i} ||s|| ~~d~~ نص عادي هنا`).join("\n").slice(0, 10_000);
  const unclosed = "**a __b ~~c ||d `e [f ".repeat(450).slice(0, 10_000);
  const brackets = "[".repeat(10_000);
  const ticks = "`a\n".repeat(3_300);
  const quotes = "> ".repeat(5_000);
  const best = (fn: () => void): number => {
    fn(); // warm up
    let min = Infinity;
    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now();
      fn();
      min = Math.min(min, performance.now() - t0);
    }
    return min;
  };

  it("a 10 000-character body parses in under 5 ms (every shape that could be slow)", () => {
    for (const [name, body] of Object.entries({ mixed, unclosed, brackets, ticks, quotes, plain: "كلمة ".repeat(2_000) })) {
      expect(body.length, name).toBeLessThanOrEqual(10_000);
      const ms = best(() => {
        parseFormatting(body);
      });
      expect(ms, `${name}: ${ms.toFixed(2)} ms`).toBeLessThan(5);
    }
  });

  it("stripFormatting is as fast", () => {
    const ms = best(() => {
      stripFormatting(mixed, { math: true });
    });
    expect(ms).toBeLessThan(5);
  });
});

describe("the model paths strip the markers (the privacy rule is unchanged: stripping only, nothing new is sent)", () => {
  const row = (id: string, body: string) => ({ id, authorId: "u1", authorName: "سلمى", body });
  const opts = { allowNames: false, askingMessageId: "m2", companyNames: [] as string[] };

  it("buildChatPrompt sends the words, not **, __, ~~, ``` or the label's markdown", () => {
    const prompt = buildChatPrompt([row("m1", "راجعوا **العرض** و ~~القديم~~ و `x`"), row("m2", "@المساعد لخّص __النقاط__ [الدليل](https://example.com/guide)")], opts);
    expect(prompt.content).toContain("راجعوا العرض و القديم و x");
    expect(prompt.content).toContain("لخّص النقاط الدليل");
    expect(prompt.content).not.toMatch(/\*\*|__|~~|`|\]\(/);
  });

  it("a link's address never reaches the model through the label syntax (the filter masks the rest as before)", () => {
    const prompt = buildChatPrompt([row("m2", "[اضغط](https://shop.example/orders/123) و https://other.example/x")], opts);
    expect(prompt.content).not.toContain("shop.example");
    expect(prompt.content).not.toContain("other.example");
  });

  it("a phone number inside a marker is still masked", () => {
    const prompt = buildChatPrompt([row("m2", "اتصلوا **0791234567** بسرعة")], opts);
    expect(prompt.content).not.toContain("0791234567");
  });

  it("a spoiler's words are kept for the model (the people who ask can read them in the conversation)", () => {
    const prompt = buildChatPrompt([row("m2", "الجواب ||نعم||")], opts);
    expect(prompt.content).toContain("الجواب نعم");
  });

  it("the assistant's instructions ask for plain text without math markup", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/plain text/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/math/i);
  });

  it("redactChatText itself is unchanged (it never formats; the callers strip first)", () => {
    expect(redactChatText("**x**").text).toBe("**x**");
  });
});

describe("review fixes (C3b.1)", () => {
  it("a name that only exists on every object («constructor», «toString») is not a math symbol", () => {
    expect(cleanMath("\\( \\constructor + \\toString + \\hasOwnProperty \\)")).toBe("constructor + toString + hasOwnProperty");
  });

  it("a label that shows an address of another site shows the real address, whether it is spelled with a scheme, www., a bare domain or inside a sentence", () => {
    const shown = (body: string) => (inlineOf(body)[0] as { label: Inline[] }).label;
    expect(shown("[paypal.com](https://evil.example/login)")).toEqual([text("https://evil.example/login")]);
    expect(shown("[Visit www.bank.com now](https://evil.example/x)")).toEqual([text("https://evil.example/x")]);
    expect(shown("[bank.com/login](https://evil.example/x)")).toEqual([text("https://evil.example/x")]);
    expect(shown("[bank.com](https://bank.com.evil.example/)")).toEqual([text("https://bank.com.evil.example/")]);
    // an honest label stays: the same site, a sub-site of the site it names, a file name, or plain words
    expect(shown("[example.com](https://example.com/a)")).toEqual([text("example.com")]);
    expect(shown("[example.com](https://shop.example.com/a)")).toEqual([text("example.com")]);
    expect(shown("[invoice.pdf](https://cdn.example.com/invoice.pdf)")).toEqual([text("invoice.pdf")]);
    expect(shown("[اضغط هنا](https://example.com)")).toEqual([text("اضغط هنا")]);
  });

  it("a spoiler is not formed inside a link's label (no button inside an anchor); it stays as typed there", () => {
    const [link] = inlineOf("[a ||b|| c](https://example.com)");
    expect(link).toMatchObject({ t: "link", label: [text("a ||b|| c")] });
  });

  it("text that was CUT (a push preview, a list preview) closes the marker that is still open at its end", () => {
    expect(stripFormatting("Hello ||the secre", { partial: true })).toBe("Hello •••");
    expect(stripFormatting("Hello **bold te", { partial: true })).toBe("Hello bold te");
    expect(stripFormatting("see [the label](https://example.com/very/lo", { partial: true })).toBe("see the label");
    expect(stripFormatting("Hello ||the secre")).toBe("Hello ||the secre");
  });

  it("a long run of unmatched math openers does not make the cleaner quadratic", () => {
    const body = "\\(".repeat(5_000);
    const t0 = performance.now();
    cleanMath(body);
    expect(performance.now() - t0).toBeLessThan(20);
  });
});
