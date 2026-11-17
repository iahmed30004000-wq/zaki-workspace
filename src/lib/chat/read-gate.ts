/**
 * May a message be marked read right now? Only while the tab is VISIBLE and the window FOCUSED (F0.5): a message marked read in a
 * tab nobody looks at puts a ✓✓ on the sender's screen for something that was never seen.
 */
export function canMarkReadNow(page: { visibilityState: string; hasFocus: () => boolean } = document): boolean {
  return page.visibilityState === "visible" && page.hasFocus();
}
