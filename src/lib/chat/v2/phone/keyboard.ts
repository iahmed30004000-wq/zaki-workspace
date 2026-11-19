/**
 * C2.8 — how much of the bottom of the page the on-screen keyboard covers, so the composer can sit above it (the hook is `use-keyboard-inset.ts`).
 *
 * Two kinds of browser: one resizes the page's content when the keyboard opens (Chrome on Android with `interactiveWidget: "resizes-content"`, set in
 * `src/app/layout.tsx`), so the visible area is the whole window and the answer is 0 — nothing is added; the other slides the keyboard OVER the page
 * (Safari on an iPhone), so the visual viewport is shorter than the window and what is missing is the keyboard.
 */

/** A change smaller than this is the address bar folding or a toolbar, not a keyboard. */
export const MIN_KEYBOARD_PX = 80;

export function keyboardInsetOf({ layoutHeight, viewportHeight, viewportTop }: { layoutHeight: number; viewportHeight: number; viewportTop: number }): number {
  const hidden = layoutHeight - viewportHeight - viewportTop;
  return Number.isFinite(hidden) && hidden >= MIN_KEYBOARD_PX ? Math.round(hidden) : 0;
}
