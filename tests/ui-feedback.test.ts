import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, ToastRow } from "@/components/ui/toast";
import { classesOf, render } from "./ui-render";

const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const noop = () => {};

describe("Spinner", () => {
  it("spins, and under reduced motion pulses instead of turning", () => {
    const classes = classesOf(render(createElement(Spinner)), /<span[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["animate-spin", "motion-reduce:animate-pulse", "rounded-full"]));
  });

  it("is drawn with theme tokens only: a quiet track and an accent arc", () => {
    const classes = classesOf(render(createElement(Spinner)), /<span[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["border-border", "border-t-accent"]));
  });

  it("without a label it is decoration (hidden from screen readers), e.g. inside a button that has its own text", () => {
    const markup = render(createElement(Spinner));
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
  });

  it("with a label it is a status that announces it (the label is read, not shown)", () => {
    const markup = render(createElement(Spinner, { label: "جارٍ التحميل…" }));
    expect(markup).toContain('role="status"');
    expect(markup).toMatch(/<span class="sr-only">جارٍ التحميل…<\/span>/);
  });

  it("has three sizes", () => {
    expect(classesOf(render(createElement(Spinner, { size: "sm" })), /<span[^>]*>/)).toContain("size-4");
    expect(classesOf(render(createElement(Spinner, { size: "md" })), /<span[^>]*>/)).toContain("size-6");
    expect(classesOf(render(createElement(Spinner, { size: "lg" })), /<span[^>]*>/)).toContain("size-10");
  });

  it("takes extra classes (a margin, a colour) without losing its own", () => {
    const classes = classesOf(render(createElement(Spinner, { className: "ms-2" })), /<span[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["ms-2", "animate-spin"]));
  });

  it("needs no provider (no hooks): a server component such as the loading screen can use it", () => {
    expect(renderToStaticMarkup(createElement(Spinner, { label: "جارٍ التحميل…" }))).toContain('role="status"');
  });
});

describe("Skeleton", () => {
  it("is a quiet pulsing block that stands still under reduced motion", () => {
    const classes = classesOf(render(createElement(Skeleton)), /<div[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["animate-pulse", "motion-reduce:animate-none", "bg-muted/25", "rounded-lg"]));
  });

  it("is hidden from screen readers (the page that owns it says it is loading)", () => {
    expect(render(createElement(Skeleton))).toContain('aria-hidden="true"');
  });

  it("needs no provider (no hooks): a server component such as the loading screen can use it", () => {
    expect(renderToStaticMarkup(createElement(Skeleton, { className: "h-4" }))).toContain("animate-pulse");
  });

  it("takes its size from the caller and lets the caller change the radius", () => {
    const classes = classesOf(render(createElement(Skeleton, { className: "h-24 w-full rounded-xl" })), /<div[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["h-24", "w-full", "rounded-xl", "animate-pulse"]));
    expect(classes).not.toContain("rounded-lg");
  });
});

describe("Toast: the notifications of the whole app", () => {
  const markup = render(createElement(Toasts, null, createElement("main", null, "الصفحة")));
  const container = /<div[^>]*aria-live="polite"[^>]*>/;

  it("keeps rendering its children, followed by the (empty) stack", () => {
    expect(markup).toContain("<main>الصفحة</main>");
    expect(markup).toMatch(/<div[^>]*aria-live="polite"[^>]*><\/div>$/);
  });

  it("on a phone the stack is at the TOP of the screen, below the notch, so it never covers a bottom sheet or the bottom bar", () => {
    const classes = classesOf(markup, container);
    expect(classes).toEqual(expect.arrayContaining(["fixed", "top-14", "start-0", "end-0", "px-4", "pt-[max(0.75rem,env(safe-area-inset-top))]"]));
    // the old bottom-end position must not apply below the md breakpoint
    expect(classes).not.toContain("bottom-4");
    expect(classes).not.toContain("end-4");
  });

  it("on a wide screen it goes to the bottom CENTRE (the owner's mock-up), full width of the screen so the pill centres itself", () => {
    const classes = classesOf(markup, container);
    expect(classes).toEqual(expect.arrayContaining(["md:top-auto", "md:bottom-6", "md:p-0"]));
    // no longer a 20rem column in the corner
    expect(classes).not.toContain("md:end-4");
    expect(classes).not.toContain("md:w-80");
  });

  it("does not block the page under it, and sits above dialogs", () => {
    expect(classesOf(markup, container)).toEqual(expect.arrayContaining(["pointer-events-none", "z-[70]"]));
  });

  it("is a polite live region (and stays announced while a dialog hides the rest of the page from screen readers)", () => {
    expect(markup).toContain('aria-live="polite"');
  });

  it("uses logical CSS only", () => {
    const classes = classesOf(markup, container);
    expect(classes.some((c) => /^(?:md:)?(?:left|right|inset-x|ml|mr|pl|pr)(?:-|$)/.test(c))).toBe(false);
  });

  const row = (kind: "success" | "error" | "info") =>
    render(createElement(ToastRow, { item: { id: 1, kind, message: "تم الحفظ" }, onDismiss: noop }));

  it("a row is a status with the message, a kind icon coloured by a theme token and a dismiss button", () => {
    const success = row("success");
    expect(success).toContain('role="status"');
    expect(success).toContain("تم الحفظ");
    expect(success).toContain("text-ok");
    expect(row("error")).toContain("text-danger");
    expect(row("info")).toContain("text-accent");
  });

  it("the dismiss button is named in Arabic (it used to say Dismiss) and is a 44px target", () => {
    const html = row("success");
    expect(html).toContain('aria-label="إغلاق التنبيه"');
    expect(html).not.toContain('aria-label="Dismiss"');
    expect(classesOf(html, /<button[^>]*>/)).toEqual(expect.arrayContaining(["size-11"]));
  });

  it("a row fades in, and does not move under reduced motion", () => {
    expect(classesOf(row("info"), /<div[^>]*role="status"[^>]*>/)).toEqual(expect.arrayContaining(["animate-fade-in", "motion-reduce:animate-none"]));
  });

  it("a row is a comfortable pill on a phone and shrinks to its text on a wide screen (the owner's mock-up: dark, centred)", () => {
    expect(classesOf(row("info"), /<div[^>]*role="status"[^>]*>/)).toEqual(
      expect.arrayContaining(["pointer-events-auto", "w-full", "max-w-sm", "md:w-auto", "md:max-w-md", "bg-fg", "text-surface", "dark:bg-surface-2", "dark:text-fg", "rounded-xl"]),
    );
  });
});
