import { isDangerousName, isForbiddenField, safeGuidePath, type GuideAction } from "@/lib/site-guide/rules";
import { GUIDE_ATTR, forbiddenControl } from "@/components/site-guide/page-reader";

/**
 * «المرشد» — what the browser does with a request of the guide. The server already cleaned it; this file refuses again, on its own rules:
 *
 *   navigate   only a path `safeGuidePath` accepts (the panel does the pushing, through the router).
 *   highlight  a ring around the control and a note beside it; scrolls it into view; changes nothing on the page.
 *   click      refused when the control is gone, disabled, a secret field, or its NAME says delete / pay / send to all / sign out /
 *              permissions (the owner presses those himself). Otherwise the panel asked him first.
 *   type       refused for a password / card / key / file field and for anything that is not a text field. Otherwise the panel asked him.
 */

export type Verdict = { ok: true } | { ok: false; reason: "gone" | "disabled" | "danger" | "field" | "kind" | "path" };

export function nameOfControl(el: HTMLElement): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function judge(action: GuideAction, el: HTMLElement | undefined): Verdict {
  if (action.type === "navigate") return safeGuidePath(action.path) ? { ok: true } : { ok: false, reason: "path" };
  if (!el || !el.isConnected) return { ok: false, reason: "gone" };
  if (action.type === "highlight") return { ok: true };
  if ((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true") return { ok: false, reason: "disabled" };
  if (forbiddenControl(el)) return { ok: false, reason: "field" };
  if (action.type === "click") {
    if (isDangerousName(nameOfControl(el))) return { ok: false, reason: "danger" };
    if (el instanceof HTMLAnchorElement) {
      // a link goes only to a page of this app that the guide itself may open (never another site, an API door or a sign-out)
      const url = new URL(el.href, location.href);
      if (url.origin !== location.origin || !safeGuidePath(`${url.pathname}${url.search}`)) return { ok: false, reason: "path" };
    }
    return { ok: true };
  }
  // type
  if (el instanceof HTMLInputElement) {
    if (isForbiddenField({ type: el.type, autocomplete: el.autocomplete, name: el.name })) return { ok: false, reason: "field" };
    if (["checkbox", "radio", "range", "color", "file", "submit", "button", "image", "reset"].includes(el.type)) return { ok: false, reason: "kind" };
    return { ok: true };
  }
  if (el instanceof HTMLTextAreaElement) return { ok: true };
  return { ok: false, reason: "kind" };
}

/** Sets a field's value so React sees it (the native setter, then an `input` event), then leaves it focused: the owner still presses «حفظ» himself. */
export function typeInto(el: HTMLElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  el.focus();
  setter?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

let cleanup: (() => void) | null = null;

/** A ring around the control and a note beside it, for a few seconds (or until the next one). */
export function highlight(el: HTMLElement, note: string, ms = 7000): void {
  clearHighlight();
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const ring = document.createElement("div");
  const bubble = document.createElement("div");
  ring.setAttribute(GUIDE_ATTR, "ring");
  bubble.setAttribute(GUIDE_ATTR, "note");
  Object.assign(ring.style, { position: "fixed", zIndex: "2147483000", pointerEvents: "none", border: "3px solid rgb(var(--accent))", borderRadius: "10px", boxShadow: "0 0 0 4px rgb(var(--accent) / 0.35)", transition: "all .2s" });
  Object.assign(bubble.style, { position: "fixed", zIndex: "2147483001", pointerEvents: "none", maxWidth: "260px", padding: "8px 10px", borderRadius: "10px", background: "rgb(var(--accent))", color: "rgb(var(--accent-fg))", fontSize: "13px", lineHeight: "1.6", direction: "rtl", boxShadow: "0 6px 18px rgb(var(--fg) / 0.35)" });
  bubble.textContent = note;
  document.body.append(ring, bubble);
  const place = () => {
    if (!el.isConnected) return clearHighlight();
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    const below = r.bottom + 10 + 70 < window.innerHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 270);
    Object.assign(bubble.style, { left: `${left}px`, top: below ? `${r.bottom + 10}px` : `${Math.max(8, r.top - 80)}px`, display: note ? "block" : "none" });
  };
  place();
  const timer = window.setInterval(place, 250);
  const stop = window.setTimeout(clearHighlight, ms);
  cleanup = () => {
    window.clearInterval(timer);
    window.clearTimeout(stop);
    ring.remove();
    bubble.remove();
  };
}

export function clearHighlight(): void {
  cleanup?.();
  cleanup = null;
}
