/** What every showcase scene lets the gallery's control pill do: the «Toggle» button and the Space key. */
export interface SceneHandle {
  toggle: () => void;
}

/** The numbered variants of the gallery, in the order of the arrows. The number is kept from the reference; the name is Arabic. */
export const GALLERY_VARIANTS = [
  { n: "01", key: "temp" },
  { n: "02", key: "lamp" },
  { n: "03", key: "repaint" },
  { n: "04", key: "ink" },
  { n: "05", key: "sky" },
  { n: "06", key: "glass" },
] as const;
export type VariantKey = (typeof GALLERY_VARIANTS)[number]["key"];

/** The design size every scene is drawn at (the reference recording's size); the gallery scales it to fit the window. */
export const STAGE_W = 1720;
export const STAGE_H = 1080;
