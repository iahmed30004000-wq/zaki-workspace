/**
 * C2.6 — copy a text and SAY whether it worked. `navigator.clipboard` is missing on an insecure address and in some webviews; `writeText` is refused without
 * a permission. Either way the person is told («تعذّر تنفيذ الإجراء»), never left with a menu item that did nothing.
 */
export async function copyText(text: string, clipboard: { writeText: (text: string) => Promise<void> } | undefined | null): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
