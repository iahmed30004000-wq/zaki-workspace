import { BOARD_TEXT_CHARS, MAX_BOARD_TEXTS, MAX_ELEMENTS, MAX_HEADINGS, MAX_NAME_CHARS, isForbiddenField, type ElementRole, type Snapshot } from "@/lib/site-guide/rules";

/**
 * «المرشد» — reads the page the owner is on, as a short list of CONTROLS (buttons, links, fields, tabs), each with a reference `e12` and an
 * accessible name. It reads nothing else: no cookies, no storage, no network, no script text, nothing from a password / card / secret field,
 * nothing from the guide's own panel (`[data-site-guide]`). The references point at live elements held in a Map in THIS tab only.
 */

export const GUIDE_ATTR = "data-site-guide";

/**
 * The whiteboard page registers this bridge while it is open (src/components/whiteboard/whiteboard-screen.tsx): the words on the board, and a way
 * to add notes and boxes. Absent everywhere else.
 */
export interface BoardBridge {
  canDraw: boolean;
  texts(): string[];
  write(items: { kind: "note" | "box"; text: string; x?: number; y?: number }[]): Promise<number>;
}
declare global {
  interface Window {
    __zakiBoard?: BoardBridge;
  }
}

export interface PageRead {
  snapshot: Snapshot;
  registry: Map<string, HTMLElement>;
}

const SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=checkbox]",
].join(",");

const clean = (text: string | null | undefined, max: number): string => [...(text ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim()].slice(0, max).join("");

function visible(el: HTMLElement): boolean {
  if (el.hidden || el.closest("[hidden],[aria-hidden=true],[inert]")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function nameOf(el: HTMLElement): string {
  const labelled = el.getAttribute("aria-label");
  if (labelled) return clean(labelled, MAX_NAME_CHARS);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (clean(text, 5)) return clean(text, MAX_NAME_CHARS);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const id = el.id;
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : el.closest("label")?.textContent;
    const text = clean(label, MAX_NAME_CHARS) || clean(el.getAttribute("placeholder"), MAX_NAME_CHARS) || clean(el.getAttribute("title"), MAX_NAME_CHARS) || clean(el.name, MAX_NAME_CHARS);
    return text;
  }
  const text = clean(el.textContent, MAX_NAME_CHARS);
  if (text) return text;
  const img = el.querySelector("img[alt]");
  return clean(img?.getAttribute("alt") ?? el.getAttribute("title"), MAX_NAME_CHARS);
}

function roleOf(el: HTMLElement): ElementRole | null {
  const role = el.getAttribute("role");
  if (role === "tab") return "tab";
  if (role === "menuitem") return "menuitem";
  if (role === "checkbox") return "checkbox";
  if (role === "button") return "button";
  if (role === "link") return "link";
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLButtonElement) return "button";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return "checkbox";
    if (el.type === "submit" || el.type === "button") return "button";
    return "input";
  }
  return null;
}

/** Is this control one the guide must never read or touch (a secret field), whatever its name? */
export function forbiddenControl(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return isForbiddenField({ type: el.type, autocomplete: el.autocomplete, name: `${el.name} ${el.id}` });
  if (el instanceof HTMLTextAreaElement) return isForbiddenField({ autocomplete: el.autocomplete, name: `${el.name} ${el.id}` });
  return false;
}

export function readPage(): PageRead {
  const registry = new Map<string, HTMLElement>();
  const found: { el: HTMLElement; role: ElementRole; name: string; inView: boolean }[] = [];
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
    if (node.closest(`[${GUIDE_ATTR}]`)) continue;
    if (forbiddenControl(node) || !visible(node)) continue;
    const role = roleOf(node);
    if (!role) continue;
    const name = nameOf(node);
    if (!name) continue;
    const rect = node.getBoundingClientRect();
    found.push({ el: node, role, name, inView: rect.bottom > 0 && rect.top < window.innerHeight });
  }
  // what is on the screen now comes first, then the rest, in page order; a long page is cut
  const ordered = [...found.filter((f) => f.inView), ...found.filter((f) => !f.inView)].slice(0, MAX_ELEMENTS);
  const elements = ordered.map((f, i) => {
    const ref = `e${i + 1}`;
    registry.set(ref, f.el);
    const value = f.el instanceof HTMLInputElement || f.el instanceof HTMLTextAreaElement ? clean(f.el.value, 80) : f.el instanceof HTMLSelectElement ? clean(f.el.selectedOptions[0]?.textContent, 80) : "";
    const disabled = (f.el as HTMLButtonElement).disabled === true || f.el.getAttribute("aria-disabled") === "true";
    return { ref, role: f.role, name: f.name, ...(value ? { value } : {}), ...(disabled ? { disabled: true } : {}) };
  });
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"))
    .filter((h) => !h.closest(`[${GUIDE_ATTR}]`) && visible(h))
    .map((h) => clean(h.textContent, 120))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);
  return {
    snapshot: {
      path: `${location.pathname}${location.search}`.slice(0, 300),
      title: clean(document.title, 200),
      headings,
      elements,
      ...boardTexts(),
    },
    registry,
  };
}

function boardTexts(): { board?: string[] } {
  const bridge = typeof window !== "undefined" ? window.__zakiBoard : undefined;
  if (!bridge) return {};
  const texts = bridge.texts().map((t) => clean(t, BOARD_TEXT_CHARS)).filter(Boolean).slice(0, MAX_BOARD_TEXTS);
  return { board: texts };
}
