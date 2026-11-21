/**
 * S5.1 — «are the message tones on for this company?» The company's switch `chatSounds` is read on the server (the layout), and the listener (`ChatSoundsHost`) says here, once it is mounted,
 * that it is on. Two places ask: the old arrival sound of the open conversation (`playChatSound` plays the chosen tone instead of the sound file while this is true) and the info panel (it
 * draws «كل الرسائل / الذكر بس» only while this is true). A tiny store, so a screen follows it without a prop.
 */

let on = false;
const listeners = new Set<() => void>();

export function chatSoundsActive(): boolean {
  return on;
}

export function setChatSoundsActive(next: boolean): void {
  if (on === next) return;
  on = next;
  for (const l of [...listeners]) l();
}

export function subscribeChatSoundsActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
