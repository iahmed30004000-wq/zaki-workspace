import { NO_SOUND, customIdOf, customSoundUrl, type SoundChoices, type SoundEvent } from "./choice";
import { builtinsFor, type BuiltinSound } from "./catalog";

/**
 * THE ONE RESOLVER: what an event sounds like for these choices. «default» is «play what you always played»: nothing chosen, or a choice that no longer
 * means anything for this event (an old id, another family's sound) — a wrong value never makes an event silent. Only «none» does.
 */
export type ResolvedSound = { type: "default" } | { type: "none" } | { type: "synth"; sound: BuiltinSound } | { type: "file"; url: string };

export function resolveSound(event: SoundEvent, choices: SoundChoices | null | undefined): ResolvedSound {
  const choice = choices?.[event];
  if (!choice) return { type: "default" };
  if (choice === NO_SOUND) return { type: "none" };
  const fileId = customIdOf(choice);
  if (fileId) return { type: "file", url: customSoundUrl(fileId) };
  const sound = builtinsFor(event).find((s) => s.id === choice);
  return sound ? { type: "synth", sound } : { type: "default" };
}
