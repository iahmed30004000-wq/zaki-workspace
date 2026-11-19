/**
 * C2.5 — what the box says when a send, an upload or a save fails. An error that carries a dictionary key (`chat.f.too_large`) is translated; one that carries an
 * Arabic sentence the composer made itself is shown as it is; ANYTHING else (a `TypeError: Failed to fetch`, a library's English) becomes the fallback sentence,
 * so no English reaches the screen and no internal text leaks. Pure.
 */
const ARABIC_LETTER = /[؀-ۿ]/;

export function failMessageOf(e: unknown, fallbackKey: string, say: (key: string) => string): string {
  const message = e instanceof Error ? e.message : "";
  if (message.startsWith("chat.")) return say(message);
  return ARABIC_LETTER.test(message) ? message : say(fallbackKey);
}
