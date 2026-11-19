import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { LinkPreviewCard } from "@/components/chat/v2/bubble/bubble-extras";
import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { menuFor, messageMenuItems, V2_MENU_ORDER, type MessageMenuContext } from "@/components/chat/message/message-menu-registry";
import { menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import {
  FAILED_RETRY_MS,
  fetchLinkPreview,
  guardedGet,
  IMAGE_MAX_BYTES,
  MAX_REDIRECTS,
  PAGE_MAX_BYTES,
  parseOpenGraph,
  PreviewFetchError,
  previewUrlOf,
  urlHashOf,
  type PreviewDeps,
} from "@/server/chat/link-preview";
import { presentMessage, type Viewer } from "@/server/chat/redact";
import { isRealtimeKind, REALTIME_KINDS } from "@/server/realtime/emit";

/**
 * C3b.2 — the pure parts of the link previews: which address a message's preview is made of (the formatter's own tokenizer), the tags of a page, the guarded request
 * (every hop through net-guard, 3 s, 512 KB, HTML only, a picture of 1 MB judged by its bytes) with a stub in the place of the network, and how a card is presented.
 * Nothing here touches the network or a database.
 */

const PUBLIC = "93.184.216.34";
const enc = new TextEncoder();
const html = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(64).fill(0)]);

interface Call {
  url: string;
  init: RequestInit;
}

/** A stub network: the handler answers by address; `resolve` answers by name (default: every name is public). */
function stub(handler: (url: string, call: Call) => Response | Promise<Response>, resolve?: (host: string) => string[]): PreviewDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    timeoutMs: 2_000,
    resolve: async (host) => (resolve ? resolve(host) : [PUBLIC]),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      return handler(call.url, call);
    }) as typeof fetch,
  };
}

const page = (body: string, type = "text/html; charset=utf-8") => new Response(body, { status: 200, headers: { "content-type": type } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const failure = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (err) {
    if (err instanceof PreviewFetchError) return err.code;
    throw err;
  }
  return "no error";
};

describe("the address a preview is made of: the formatter's own tokenizer", () => {
  it("is the FIRST link of the text, https only, with the part after # dropped", () => {
    expect(previewUrlOf("شوف هاد https://example.com/a?x=1#part وبعدين https://other.example/")).toBe("https://example.com/a?x=1");
    expect(previewUrlOf("www.example.com/path")).toBe("https://www.example.com/path");
    expect(previewUrlOf("[الدليل](https://docs.example.com/guide) تفضل")).toBe("https://docs.example.com/guide");
    // the sentence's own punctuation (an Arabic comma, a full stop) is not part of the address
    expect(previewUrlOf("https://example.com/a،")).toBe("https://example.com/a");
    expect(previewUrlOf("اقرا https://example.com/a.")).toBe("https://example.com/a");
  });

  it("is nothing for http, mailto, an in-app path, a script address, an address with a password or no link at all", () => {
    for (const body of ["http://example.com/", "mailto:a@example.com", "/chat/abc", "javascript:alert(1)", "https://google.com@evil.example/", "مرحبا بدون رابط", "ftp://example.com/x"]) {
      expect(previewUrlOf(body), body).toBeNull();
    }
  });

  it("is nothing for a link to this app's own address (the server would visit itself)", () => {
    const before = process.env["APP_URL"];
    process.env["APP_URL"] = "https://workspace.example.org";
    try {
      expect(previewUrlOf("https://workspace.example.org/chat/x")).toBeNull();
      expect(previewUrlOf("https://other.example.org/chat/x")).not.toBeNull();
    } finally {
      if (before === undefined) delete process.env["APP_URL"];
      else process.env["APP_URL"] = before;
    }
  });

  it("the key of a page carries the company: the same address in two companies is two rows", () => {
    expect(urlHashOf("org1", "https://example.com/")).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHashOf("org1", "https://example.com/")).toBe(urlHashOf("org1", "https://example.com/"));
    expect(urlHashOf("org1", "https://example.com/")).not.toBe(urlHashOf("org2", "https://example.com/"));
    expect(urlHashOf("org1", "https://example.com/a")).not.toBe(urlHashOf("org1", "https://example.com/b"));
  });
});

describe("the tags of a page", () => {
  it("reads og:title, og:description, og:site_name and og:image (attributes in any order, any quotes)", () => {
    const og = parseOpenGraph(
      html(`<meta property="og:title" content="عنوان الصفحة"><meta content='وصف قصير' property='og:description'><meta property=og:site_name content=موقعي><meta property="og:image" content="https://cdn.example.com/p.png">`),
      "https://example.com/a",
    );
    expect(og).toEqual({ title: "عنوان الصفحة", description: "وصف قصير", siteName: "موقعي", imageUrl: "https://cdn.example.com/p.png" });
  });

  it("resolves a relative picture against the page and keeps the first tag of a name", () => {
    const og = parseOpenGraph(html(`<meta property="og:image" content="/img/cover.jpg"><meta property="og:image" content="https://evil.example/x.png"><meta property="og:title" content="الأول"><meta property="og:title" content="التاني">`), "https://example.com/news/1");
    expect(og.imageUrl).toBe("https://example.com/img/cover.jpg");
    expect(og.title).toBe("الأول");
  });

  it("falls back to <title> and the plain description, and to the twitter tags", () => {
    expect(parseOpenGraph(html(`<title> صفحة   بسيطة </title><meta name="description" content="وصفها">`), "https://example.com/")).toMatchObject({ title: "صفحة بسيطة", description: "وصفها" });
    expect(parseOpenGraph(html(`<meta name="twitter:title" content="تويتر"><meta name="twitter:image" content="https://cdn.example.com/t.webp">`), "https://example.com/")).toMatchObject({ title: "تويتر", imageUrl: "https://cdn.example.com/t.webp" });
  });

  it("decodes entities once (never twice) and keeps every word as TEXT: markup in a tag is stripped, not kept", () => {
    const og = parseOpenGraph(html(`<meta property="og:title" content="a &amp; b &quot;c&quot; &#39;d&#39; &#x27;e&#x27; &#1575;"><meta property="og:description" content="&amp;lt;script&amp;gt; <b>غامق</b><i>مائل</i>">`), "https://example.com/");
    expect(og.title).toBe(`a & b "c" 'd' 'e' ا`);
    expect(og.description).toBe("&lt;script&gt; غامق مائل");
  });

  it("a > inside a quoted value does not end the tag", () => {
    const og = parseOpenGraph(html(`<meta property="og:description" content="نصائح > حيل"><meta property="og:title" content='a > b'>`), "https://example.com/");
    expect(og).toMatchObject({ description: "نصائح > حيل", title: "a > b" });
  });

  it("drops invisible and direction characters, folds white space, and cuts a long text with an ellipsis", () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const long = "ك".repeat(500);
    const og = parseOpenGraph(html(`<meta property="og:title" content="  شراء${rlo} الآن${zwsp}\n\t  الحين "><meta property="og:description" content="${long}"><meta property="og:site_name" content="${"س".repeat(200)}">`), "https://example.com/");
    expect(og.title).toBe("شراء الآن الحين");
    expect([...og.description!]).toHaveLength(300);
    expect(og.description!.endsWith("…")).toBe(true);
    expect([...og.siteName!]).toHaveLength(80);
  });

  it("does not read tags inside a comment, a script or a style, nor anything after </head>", () => {
    const og = parseOpenGraph(
      `<html><head><!-- <meta property="og:title" content="comment"> --><script>var s='<meta property="og:title" content="script">'</script><style>/* <meta property="og:title" content="style"> */</style><meta property="og:title" content="الحقيقي"></head><body><meta property="og:description" content="body"></body></html>`,
      "https://example.com/",
    );
    expect(og.title).toBe("الحقيقي");
    expect(og.description).toBeNull();
  });

  it("takes a picture only when it is an http(s) address", () => {
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://example.com/a.png", "//:"]) {
      expect(parseOpenGraph(html(`<meta property="og:image" content="${bad}">`), "https://example.com/").imageUrl, bad).toBeNull();
    }
  });

  it("an empty or broken page gives nothing, and a 500 KB page is read in a blink", () => {
    expect(parseOpenGraph("", "https://example.com/")).toEqual({ title: null, description: null, siteName: null, imageUrl: null });
    expect(parseOpenGraph("<meta <meta property=", "https://example.com/").title).toBeNull();
    const big = html(`<meta property="og:title" content="t">${'<meta name="x" content="y">'.repeat(18_000)}`);
    const t0 = performance.now();
    expect(parseOpenGraph(big, "https://example.com/").title).toBe("t");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("the guarded request goes through net-guard at every hop", () => {
  it("refuses a private or internal address BEFORE any request is made", async () => {
    for (const url of ["https://10.0.0.5/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://localhost/", "https://db/", "https://192.168.1.10/x"]) {
      const deps = stub(() => page(html("")));
      expect(await failure(fetchLinkPreview(url, deps)), url).toBe("unsafe");
      expect(deps.calls, url).toHaveLength(0);
    }
  });

  it("refuses http, and a name that resolves to a private address (any one of its answers)", async () => {
    const plain = stub(() => page(html("")));
    expect(await failure(fetchLinkPreview("http://example.com/", plain))).toBe("unsafe");
    expect(plain.calls).toHaveLength(0);
    const sneaky = stub(() => page(html("")), () => [PUBLIC, "10.1.2.3"]);
    expect(await failure(fetchLinkPreview("https://rebind.example.com/", sneaky))).toBe("unsafe");
    expect(sneaky.calls).toHaveLength(0);
  });

  it("refuses a redirect to a private address: the second hop is judged, and never asked for", async () => {
    for (const target of ["https://internal.example.com/admin", "https://169.254.169.254/latest", "https://10.0.0.9/", "http://example.com/plain"]) {
      const deps = stub((url) => (url.startsWith("https://start.example.com") ? redirect(target) : page(html(`<meta property="og:title" content="secret">`))), (host) => (host === "internal.example.com" ? ["192.168.0.4"] : [PUBLIC]));
      expect(await failure(fetchLinkPreview("https://start.example.com/", deps)), target).toBe("unsafe");
      expect(deps.calls.map((c) => c.url), target).toEqual(["https://start.example.com/"]);
    }
  });

  it("follows a public redirect (relative ones too) up to three hops, and refuses a fourth", async () => {
    const ok = stub((url) => (url === "https://a.example.com/" ? redirect("/b") : url === "https://a.example.com/b" ? redirect("https://c.example.com/final") : page(html(`<meta property="og:title" content="وصلنا">`))));
    expect((await fetchLinkPreview("https://a.example.com/", ok)).title).toBe("وصلنا");
    expect(ok.calls.map((c) => c.url)).toEqual(["https://a.example.com/", "https://a.example.com/b", "https://c.example.com/final"]);

    let n = 0;
    const loop = stub(() => redirect(`https://hop${(n += 1)}.example.com/`));
    expect(await failure(fetchLinkPreview("https://start.example.com/", loop))).toBe("redirects");
    expect(loop.calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("sends no cookie, no authorization, no referrer, and never follows a redirect by itself", async () => {
    const deps = stub(() => page(html(`<meta property="og:title" content="x">`)));
    await fetchLinkPreview("https://example.com/", deps);
    const { init } = deps.calls[0]!;
    const names = Object.keys((init.headers ?? {}) as Record<string, string>).map((n) => n.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("authorization");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.method).toBe("GET");
  });

  it("takes HTML only: a picture, JSON or a download in the place of the page is refused", async () => {
    for (const type of ["image/png", "application/json", "application/pdf", "text/plain"]) {
      expect(await failure(fetchLinkPreview("https://example.com/", stub(() => page("x", type)))), type).toBe("not_html");
    }
    expect((await fetchLinkPreview("https://example.com/", stub(() => page(html(`<meta property="og:title" content="xhtml">`), "application/xhtml+xml")))).title).toBe("xhtml");
  });

  it("a status that is not a success (404, 500) makes no card", async () => {
    expect(await failure(fetchLinkPreview("https://example.com/", stub(() => new Response("no", { status: 404, headers: { "content-type": "text/html" } }))))).toBe("status");
    expect(await failure(fetchLinkPreview("https://example.com/", stub(() => redirect("")) ))).toBe("status");
  });

  it("reads at most 512 KB of a page and drops the rest (the head is at the top)", async () => {
    const head = html(`<meta property="og:title" content="من الرأس">`);
    const huge = head + "x".repeat(2 * PAGE_MAX_BYTES);
    const deps = stub(() => page(huge));
    const got = await guardedGet("https://example.com/", { accept: "text/html", maxBytes: PAGE_MAX_BYTES, truncate: true, allowType: () => true, wrongType: "not_html" }, deps);
    expect(got.bytes.length).toBe(PAGE_MAX_BYTES);
    expect(got.truncated).toBe(true);
    expect((await fetchLinkPreview("https://example.com/", stub(() => page(huge)))).title).toBe("من الرأس");
  });

  it("gives up after 3 seconds as a whole (the default), and says why", async () => {
    const hangs: PreviewDeps = { fetch: ((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch, resolve: async () => [PUBLIC], timeoutMs: 40 };
    expect(await failure(fetchLinkPreview("https://slow.example.com/", hangs))).toBe("timeout");
    // the real budget is three seconds
    const { PREVIEW_TIMEOUT_MS } = await import("@/server/chat/link-preview");
    expect(PREVIEW_TIMEOUT_MS).toBe(3_000);
  });

  it("a network error is its own reason, and a page with neither a title nor a description makes no card", async () => {
    const down: PreviewDeps = { fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, resolve: async () => [PUBLIC], timeoutMs: 500 };
    expect(await failure(fetchLinkPreview("https://example.com/", down))).toBe("network");
    expect(await failure(fetchLinkPreview("https://example.com/", stub(() => page(html(`<meta property="og:image" content="https://cdn.example.com/p.png">`)))))).toBe("empty");
  });

  it("reads a page written in windows-1256 from the charset of its header", async () => {
    const head = enc.encode(`<html><head><meta property="og:title" content="`);
    const word = Uint8Array.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]); // مرحبا
    const tail = enc.encode(`"></head></html>`);
    const bytes = new Uint8Array(head.length + word.length + tail.length);
    bytes.set(head, 0);
    bytes.set(word, head.length);
    bytes.set(tail, head.length + word.length);
    const deps = stub(() => new Response(bytes, { status: 200, headers: { "content-type": "text/html; charset=windows-1256" } }));
    expect((await fetchLinkPreview("https://example.com/", deps)).title).toBe("مرحبا");
  });
});

describe("the picture of a card", () => {
  const withImage = (image: Response | ((url: string) => Response), resolve?: (host: string) => string[]) =>
    stub((url) => (url.startsWith("https://example.com/") ? page(html(`<meta property="og:title" content="t"><meta property="og:image" content="https://cdn.example.com/p.png">`)) : typeof image === "function" ? image(url) : image), resolve);

  it("is taken through the same guard and judged by its bytes (a real png)", async () => {
    const deps = withImage(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    const got = await fetchLinkPreview("https://example.com/", deps);
    expect(got.image?.mime).toBe("image/png");
    expect(got.image?.bytes.length).toBe(PNG.length);
    expect(got.imageIssue).toBeUndefined();
  });

  it("over 1 MB is refused (declared or not): the card is made without it", async () => {
    const declared = withImage(new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(IMAGE_MAX_BYTES + 1) } }));
    expect(await fetchLinkPreview("https://example.com/", declared)).toMatchObject({ title: "t", image: null, imageIssue: "too_large" });
    const big = new Uint8Array(IMAGE_MAX_BYTES + 10);
    big.set(PNG, 0);
    const undeclared = withImage(new Response(big, { status: 200, headers: { "content-type": "image/png" } }));
    expect(await fetchLinkPreview("https://example.com/", undeclared)).toMatchObject({ title: "t", image: null, imageIssue: "too_large" });
    // exactly 1 MB is fine
    const exact = new Uint8Array(IMAGE_MAX_BYTES);
    exact.set(PNG, 0);
    expect((await fetchLinkPreview("https://example.com/", withImage(new Response(exact, { status: 200, headers: { "content-type": "image/png" } })))).image?.bytes.length).toBe(IMAGE_MAX_BYTES);
  });

  it("is judged by what it IS, not by what the site says: an svg, a page or a script sent as image/png is not a picture", async () => {
    for (const bytes of [enc.encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), enc.encode("<html>not a picture</html>"), enc.encode("GIF8")]) {
      const deps = withImage(new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }));
      const got = await fetchLinkPreview("https://example.com/", deps);
      // GIF8 + nothing is a gif by its magic bytes: only the text ones are refused
      if (bytes.length === 4) expect(got.image?.mime).toBe("image/gif");
      else expect(got, new TextDecoder().decode(bytes)).toMatchObject({ image: null, imageIssue: "not_image" });
    }
  });

  it("is refused when it is not an image type at all, and when its address is private (no request is made for it)", async () => {
    const html2 = withImage(new Response("<p>x</p>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await fetchLinkPreview("https://example.com/", html2)).toMatchObject({ image: null, imageIssue: "not_image" });
    const internal = withImage(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }), (host) => (host === "cdn.example.com" ? ["10.9.9.9"] : [PUBLIC]));
    expect(await fetchLinkPreview("https://example.com/", internal)).toMatchObject({ title: "t", image: null, imageIssue: "unsafe" });
    expect(internal.calls.map((c) => c.url)).toEqual(["https://example.com/"]);
  });

  it("a picture that redirects to a private address is refused at that hop", async () => {
    const deps = withImage((url) => (url.startsWith("https://cdn.example.com/") ? redirect("https://169.254.169.254/latest") : page("x")));
    expect(await fetchLinkPreview("https://example.com/", deps)).toMatchObject({ title: "t", image: null, imageIssue: "unsafe" });
    expect(deps.calls.map((c) => c.url)).toEqual(["https://example.com/", "https://cdn.example.com/p.png"]);
  });
});

describe("the card as one viewer receives it", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: "m1",
    kind: "TEXT",
    body: "https://example.com/a",
    createdAt: new Date("2026-11-20T10:00:00Z"),
    pinned: false,
    editedAt: null,
    deletedAt: null,
    authorId: "u1",
    preview: { url: "https://example.com/a", title: "عنوان", description: "وصف", siteName: "موقع", imageFileId: "f1", status: "OK" },
    ...extra,
  });
  const viewer = (extra: Partial<Viewer> = {}): Viewer => ({ userId: "u2", role: "MEMBER", canModerateHere: false, ...extra });

  it("carries the words and the APP's address of the picture (never the site's)", () => {
    const dto = presentMessage(row() as never, viewer());
    expect(dto.preview).toEqual({ url: "https://example.com/a", title: "عنوان", description: "وصف", siteName: "موقع", image: "/api/chat/messages/m1/preview/image" });
    const noImage = presentMessage(row({ preview: { url: "https://example.com/a", title: "t", description: null, siteName: null, imageFileId: null, status: "OK" } }) as never, viewer());
    expect(noImage.preview?.image).toBeNull();
  });

  it("is absent on a deleted message (for the owner too), on a failed card, on a message with none, and while the switch is off", () => {
    expect(presentMessage(row({ deletedAt: new Date() }) as never, viewer()).preview).toBeUndefined();
    expect(presentMessage(row({ deletedAt: new Date() }) as never, viewer({ role: "OWNER", oversight: true })).preview).toBeUndefined();
    expect(presentMessage(row({ preview: { url: "https://example.com/a", title: null, description: null, siteName: null, imageFileId: null, status: "FAILED" } }) as never, viewer()).preview).toBeUndefined();
    expect(presentMessage(row({ preview: null }) as never, viewer()).preview).toBeUndefined();
    expect(presentMessage(row() as never, viewer({ linkPreviews: false })).preview).toBeUndefined();
    expect(presentMessage(row() as never, viewer({ linkPreviews: true })).preview).toBeDefined();
  });

  it("is the same card for a guest as for the text (a guest who reads the words reads the card)", () => {
    expect(presentMessage(row() as never, viewer({ role: "GUEST" })).preview?.title).toBe("عنوان");
  });

  it("is not drawn on a poll, a voice note or a card message", () => {
    for (const kind of ["POLL", "VOICE", "CARD", "SYSTEM"]) expect(presentMessage(row({ kind }) as never, viewer()).preview, kind).toBeUndefined();
  });
});

describe("the realtime kind", () => {
  it("`message.enriched` is in the ONE list (the stream, the replay and the listener all read it)", () => {
    expect(REALTIME_KINDS).toContain("message.enriched");
    expect(isRealtimeKind("message.enriched")).toBe(true);
  });
});

describe("the retry pause", () => {
  afterEach(() => undefined);
  it("a page that failed is left alone for ten minutes", () => {
    expect(FAILED_RETRY_MS).toBe(10 * 60 * 1000);
  });
});

describe("the card in the bubble", () => {
  const preview = { url: "https://example.com/a?x=1", title: "عنوان الصفحة", description: "وصف الصفحة", siteName: "موقع الأخبار", image: "/api/chat/messages/m1/preview/image" };

  it("is ONE link that opens the page in a new tab (noopener), with the app's own picture, the site, the title and the description", () => {
    const html = renderToStaticMarkup(createElement(LinkPreviewCard, { preview }));
    expect(html).toContain("data-link-preview");
    expect(html).toContain('href="https://example.com/a?x=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('src="/api/chat/messages/m1/preview/image"');
    for (const word of ["عنوان الصفحة", "وصف الصفحة", "موقع الأخبار"]) expect(html).toContain(word);
    expect(html).toContain(AR["chatlp.card"]!.replace("{title}", "عنوان الصفحة"));
  });

  it("draws nothing without a preview, while switched off, or for an address that is not a safe https link", () => {
    expect(renderToStaticMarkup(createElement(LinkPreviewCard, { preview: undefined }))).toBe("");
    expect(renderToStaticMarkup(createElement(LinkPreviewCard, { preview, enabled: false }))).toBe("");
    for (const url of ["javascript:alert(1)", "http://example.com/", "/chat/abc", "data:text/html,x", "https://u:p@example.com/"]) {
      expect(renderToStaticMarkup(createElement(LinkPreviewCard, { preview: { ...preview, url } })), url).toBe("");
    }
  });

  it("never draws a picture from anywhere but the app, and draws the page's words as TEXT (markup stays inert)", () => {
    for (const image of ["https://evil.example.com/x.png", "//evil.example.com/x.png", "javascript:alert(1)", "/api/files/x/download"]) {
      expect(renderToStaticMarkup(createElement(LinkPreviewCard, { preview: { ...preview, image } })), image).not.toContain("<img");
    }
    const html = renderToStaticMarkup(createElement(LinkPreviewCard, { preview: { ...preview, title: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>" } }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("a card with no title draws the site's name, or the host", () => {
    const html = renderToStaticMarkup(createElement(LinkPreviewCard, { preview: { url: "https://www.example.com/p", title: null, description: null, siteName: null, image: null } }));
    expect(html).toContain("example.com");
    expect(html).not.toContain("<img");
  });
});

describe("the composer's line about the preview", () => {
  const noop = () => undefined;
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const engine = (body: string): SurfaceEngine =>
    ({
      body, files: [], busy: false, error: "", progress: [], voice: { mode: "idle" }, face: "send", canSubmit: true, choices: [], pickAt: 0, setPick: noop, hint: null,
      textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
      onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: (async () => undefined) as never, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop,
    }) as unknown as SurfaceEngine;
  const draw = (body: string, over: { linkPreviews?: boolean; editing?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(Translations, { initial: "ar" }, createElement(ComposerSurface, { c: engine(body), me: {}, reply: null, editing: over.editing ? makeMessage({ mine: true, body }) : null, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop, linkPreviews: over.linkPreviews })),
    );

  it("a https link in the box shows the line with the warning, the way out and the ✕ button", () => {
    const html = draw("شوف https://example.com/a");
    expect(html).toContain("data-link-preview-chip");
    expect(html).toContain("data-link-preview-off");
    expect(html).toContain(AR["chatlp.composer"]!.replace("{host}", "example.com"));
    expect(html).toContain("⚠️");
    expect(html).toContain("🔧");
    expect(html).toContain(AR["chatlp.composer_off"]!);
  });

  it("no line for a box without a link, for http or mailto, while an edit is typed, or while the switch is off", () => {
    for (const body of ["مرحبا", "http://example.com/a", "mailto:a@example.com", ""]) expect(draw(body), body).not.toContain("data-link-preview-chip");
    expect(draw("https://example.com/a", { editing: true })).not.toContain("data-link-preview-chip");
    expect(draw("https://example.com/a", { linkPreviews: false })).not.toContain("data-link-preview-chip");
  });
});

describe("«شيل المعاينة» in the menu (opt-in, the new screen, my own message with a card)", () => {
  const base = (over: Partial<MessageMenuContext> = {}): MessageMenuContext => ({ mine: true, deleted: false, kind: "TEXT", hasText: true, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: false, oversight: false, surface: "v2", hasPreview: true, ...over });
  const ids = (c: MessageMenuContext) => menuFor(c).map((i) => i.id as string);

  it("is offered to the author of a message that carries a card, on the new screen only", () => {
    expect(ids(base())).toContain("removePreview");
    expect(ids(base({ mine: false }))).not.toContain("removePreview");
    expect(ids(base({ hasPreview: false }))).not.toContain("removePreview");
    expect(ids(base({ hasPreview: undefined }))).not.toContain("removePreview");
    const { surface: _surface, ...old } = base();
    void _surface;
    expect(ids(old as MessageMenuContext)).not.toContain("removePreview");
    expect(ids(base({ deleted: true }))).toEqual([]);
  });

  it("has its place in the new order, its words, and is not marked dangerous", () => {
    expect(V2_MENU_ORDER).toContain("removePreview");
    expect(AR["chatlp.menu_remove"]).toBe("شيل المعاينة");
    const item = messageMenuItems.find((i) => i.id === "removePreview")!;
    expect(item.labelKey(base())).toBe("chatlp.menu_remove");
    expect(item.danger).toBeUndefined();
  });

  it("the new screen's context knows whether the message has a card", () => {
    const facts = bubbleFactsOf(makeHeader());
    const withCard = makeMessage({ mine: true, preview: { url: "https://example.com/a", title: "t", description: null, siteName: null, image: null } });
    expect(menuContextV2(withCard, facts, { readerCount: 0, askKind: false }).hasPreview).toBe(true);
    expect(menuContextV2(makeMessage({ mine: true }), facts, { readerCount: 0, askKind: false }).hasPreview).toBe(false);
  });
});

describe("the guide says the server visits the link", () => {
  it("the chat article carries the warning with its way out, and the privacy article names the exception", async () => {
    const { ARTICLES } = await import("@/lib/guide/articles");
    const chat = ARTICLES.find((a) => a.slug === "chat")!;
    const warn = chat.blocks.find((b) => b.type === "warn" && b.text.includes("السيرفر هو اللي بيفتح الرابط"));
    expect(warn).toBeDefined();
    if (warn?.type === "warn") {
      expect(warn.text).toContain("عنوان السيرفر");
      expect(warn.fix).toContain("شيل المعاينة");
    }
    const privacy = ARTICLES.find((a) => a.slug === "privacy")!;
    expect(privacy.blocks.some((b) => b.type === "p" && b.text.includes("السيرفر بيفتحه ليعمل المعاينة"))).toBe(true);
  });
});
