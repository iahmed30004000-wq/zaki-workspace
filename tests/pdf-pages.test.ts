import { describe, expect, it } from "vitest";
import { countPdfPages, MAX_PAGE_SCAN_BYTES } from "@/server/files/pdf-pages";

const bytes = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));

describe("countPdfPages: a cheap page count read straight from the file", () => {
  it("reads the /Count of the page tree's root", () => {
    const pdf = bytes("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF");
    expect(countPdfPages(pdf)).toBe(3);
  });

  it("a nested tree counts every page once (the root holds the largest /Count), whatever the order of the keys", () => {
    const pdf = bytes(
      "%PDF-1.7\n2 0 obj\n<< /Count 5 /Kids [3 0 R 4 0 R] /Type /Pages >>\nendobj\n3 0 obj\n<< /Type /Pages /Parent 2 0 R /Kids [] /Count 2 >>\nendobj\n4 0 obj\n<<\n/Type/Pages\n/Parent 2 0 R\n/Count 3\n>>\nendobj\n%%EOF",
    );
    expect(countPdfPages(pdf)).toBe(5);
  });

  it("without a readable tree it counts the page objects (but never mistakes /Pages for /Page)", () => {
    const pdf = bytes("%PDF-1.3\n3 0 obj\n<< /Type /Page >>\nendobj\n4 0 obj\n<< /Type/Page >>\nendobj\n5 0 obj\n<< /Type /Page /Contents 6 0 R >>\nendobj\n");
    expect(countPdfPages(pdf)).toBe(3);
  });

  it("answers null (unknown) rather than guess: compressed object streams, nothing readable, not a PDF, too big", () => {
    expect(countPdfPages(bytes("%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N 3 /Length 99 >>\nstream\n\u0001\u0002\u0003\nendstream\nendobj\n"))).toBeNull();
    expect(countPdfPages(bytes("%PDF-1.4\n"))).toBeNull();
    expect(countPdfPages(bytes("hello, I am not a pdf /Type /Pages /Count 9"))).toBeNull();
    expect(countPdfPages(new Uint8Array(0))).toBeNull();
    expect(countPdfPages({ length: MAX_PAGE_SCAN_BYTES + 1 } as unknown as Uint8Array)).toBeNull();
  });

  it("a silly /Count (zero, or beyond any real document) is not trusted", () => {
    expect(countPdfPages(bytes("%PDF-1.4\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n"))).toBeNull();
    expect(countPdfPages(bytes("%PDF-1.4\n2 0 obj\n<< /Type /Pages /Count 99999999 /Kids [] >>\nendobj\n"))).toBeNull();
  });
});
