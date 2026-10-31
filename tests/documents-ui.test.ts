import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/documents",
}));

import { AR } from "@/lib/i18n/dict";
import { DocBody } from "@/components/documents/doc-body";
import { DocumentsView } from "@/components/documents/documents-view";
import { ConflictBanner } from "@/components/documents/document-page";
import { pagesText } from "@/components/files/pdf-viewer";
import { ToastProvider } from "@/components/ui/toast";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The rules every screen of the feature keeps: theme tokens only, logical (RTL-safe) directions, no raw hex. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("DocBody draws a document with its own elements, never as HTML", () => {
  const markup = render(
    createElement(DocBody, {
      names: ["سارة"],
      content: "# عنوان\n## فرعي\nنص **غامق** و[رابط](https://example.com)\n- نقطة\n1. بند\nيا @سارة شوف [خبيث](javascript:alert(1)) <script>alert(1)</script>",
    }),
  );

  it("headings, bullets, numbers, bold, a safe link and a mention", () => {
    expect(markup).toContain("<h2");
    expect(markup).toContain("<h3");
    expect(markup).toContain("<ul");
    expect(markup).toContain("<ol");
    expect(markup).toContain("<strong");
    expect(markup).toContain('href="https://example.com/"');
    expect(markup).toContain('rel="noopener noreferrer nofollow"');
    expect(textOf(markup)).toContain("@سارة");
  });

  it("a javascript: address and a script tag are only words on the page", () => {
    expect(markup).not.toContain('href="javascript');
    expect(markup).not.toContain("<script");
    expect(markup).toContain("&lt;script&gt;");
    expect(textOf(markup)).toContain("javascript:alert(1)");
    expectClean(markup);
  });

  it("an empty document says so instead of drawing nothing", () => {
    expect(textOf(render(createElement(DocBody, { content: "", emptyText: AR["docs.preview_empty"]! })))).toContain(AR["docs.preview_empty"]!);
  });
});

describe("the list", () => {
  const rows = [
    { id: "d1", title: "خطة الإطلاق", excerpt: "أول سطرين من الخطة", version: 3, sharedWithPartners: true, updatedAt: new Date().toISOString(), authorName: "سارة" },
    { id: "d2", title: "محضر الاجتماع", excerpt: "", version: 1, sharedWithPartners: false, updatedAt: new Date().toISOString(), authorName: null },
  ];

  it("shows each document, its excerpt, who wrote it, and the «مشترك مع الشركاء» mark only where it applies", () => {
    const markup = render(createElement(ToastProvider, null, createElement(DocumentsView, { spaceId: "s1", spaceName: "التسويق", initial: rows, canCreate: true })));
    const text = textOf(markup);
    expect(text).toContain("خطة الإطلاق");
    expect(text).toContain("أول سطرين من الخطة");
    expect(text).toContain("سارة");
    expect(text.split(AR["docs.badge_shared"]!).length - 1).toBe(1);
    expect(markup).toContain('href="/documents/d1"');
    expect(text).toContain(AR["docs.new"]!);
    expectClean(markup);
  });

  it("a person who cannot write is offered no «مستند جديد», and an empty list speaks to a partner differently", () => {
    const text = textOf(render(createElement(ToastProvider, null, createElement(DocumentsView, { spaceId: "s1", spaceName: "التسويق", initial: [], canCreate: false }))));
    expect(text).not.toContain(AR["docs.new"]!);
    expect(text).toContain(AR["docs.empty_partner"]!);
    expect(textOf(render(createElement(ToastProvider, null, createElement(DocumentsView, { spaceId: "s1", spaceName: "التسويق", initial: [], canCreate: true }))))).toContain(AR["docs.empty"]!);
  });
});

describe("the conflict banner: three honest choices", () => {
  const current = { title: "ت", content: "ن", version: 7, updatedAt: new Date().toISOString(), lastEditorName: "عمر" };
  it("names who saved first and offers keep, take and copy", () => {
    const markup = render(createElement(ConflictBanner, { current, onKeep: () => {}, onTake: () => {}, onCopy: () => {} }));
    const text = textOf(markup);
    expect(text).toContain("عمر");
    expect(text).toContain(AR["docs.conflict.keep"]!);
    expect(text).toContain(AR["docs.conflict.take"]!);
    expect(text).toContain(AR["docs.conflict.copy"]!);
    expect(markup).toContain('role="alert"');
    expectClean(markup);
  });
  it("still reads when the editor is unknown", () => {
    const text = textOf(render(createElement(ConflictBanner, { current: { ...current, lastEditorName: null }, onKeep: () => {}, onTake: () => {}, onCopy: () => {} })));
    expect(text).toContain(AR["docs.conflict.title"]!);
    expect(text).not.toContain("null");
  });
});

describe("the PDF viewer's page count reads in Arabic number forms", () => {
  it("one, two, a few, many", () => {
    expect(pagesText(1)).toBe("صفحة واحدة");
    expect(pagesText(2)).toBe("صفحتين");
    expect(pagesText(5)).toBe("5 صفحات");
    expect(pagesText(12)).toBe("12 صفحة");
  });
});

describe("the feature's wiring", () => {
  it("the page and the routes never write HTML from a document, and the screens never use dangerouslySetInnerHTML", () => {
    for (const file of ["src/components/documents/doc-body.tsx", "src/components/documents/document-page.tsx", "src/components/documents/documents-view.tsx", "src/components/files/pdf-viewer.tsx"]) {
      expect(read(file), file).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("the document route files all answer through withApi / withDocApi (a failure never leaks a stack)", () => {
    for (const file of ["route.ts", "[id]/route.ts", "[id]/revisions/route.ts", "[id]/restore/route.ts", "[id]/share/route.ts"]) {
      expect(read(`src/app/api/documents/${file}`), file).toMatch(/withApi|withDocApi/);
    }
  });
});
