/**
 * How a round video message plays, with no browser in it. By itself it only ever plays MUTED, and only while it is on the screen, the
 * page is looked at and movement is wanted (the effect «الملصقات المتحركة», which a request for less motion switches off too). A tap
 * gives it sound from the start; a tap again pauses and goes on; at its end, or once it leaves the screen, it is muted again.
 */
export type NoteSound = "muted" | "playing" | "paused";

export interface PlayFacts {
  /** the bubble is on the screen */
  visible: boolean;
  /** the page is looked at */
  pageShown: boolean;
  /** movement is wanted on this device */
  autoplay: boolean;
}

/** Should the muted preview be running? */
export const previewRuns = (sound: NoteSound, facts: PlayFacts): boolean => sound === "muted" && facts.visible && facts.pageShown && facts.autoplay;

/** What a tap does. */
export const tapNote = (sound: NoteSound): NoteSound => (sound === "playing" ? "paused" : "playing");

/** Leaving the screen or the page takes the sound with it. */
export const leaveNote = (sound: NoteSound, facts: Pick<PlayFacts, "visible" | "pageShown">): NoteSound => (facts.visible && facts.pageShown ? sound : "muted");

/** ONE note sounds at a time: the one that starts stops the one before it. Returns the way to give the turn back. */
let sounding: (() => void) | null = null;
export function takeTheSound(stop: () => void): () => void {
  if (sounding && sounding !== stop) sounding();
  sounding = stop;
  return () => {
    if (sounding === stop) sounding = null;
  };
}
