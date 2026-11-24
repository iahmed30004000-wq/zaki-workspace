/**
 * The photo editor's numbers (S6.2, Telegram's «قص · رسم · تعديل»): what a picture is turned, cropped, brightened and drawn on with. The canvas work itself is the browser's
 * (`photo-editor.tsx`); everything that decides the result is here, so it can be tested without a canvas.
 */

export type CropPreset = "free" | "square" | "four-three" | "sixteen-nine";
export const CROP_PRESETS: readonly CropPreset[] = ["free", "square", "four-three", "sixteen-nine"];
const RATIO: Record<Exclude<CropPreset, "free">, number> = { square: 1, "four-three": 4 / 3, "sixteen-nine": 16 / 9 };

/** One pen stroke: points as fractions (0..1) of the cropped picture, the width as a fraction of its shorter side, so a stroke is the same at any size. */
export interface Stroke {
  color: string;
  width: number;
  points: Array<[number, number]>;
}

export interface EditState {
  /** quarter turns clockwise */
  turns: 0 | 1 | 2 | 3;
  crop: CropPreset;
  /** 0..100 */
  enhance: number;
  /** -100..100 */
  exposure: number;
  /** -100..100 */
  contrast: number;
  strokes: Stroke[];
}

export const emptyEdit: EditState = { turns: 0, crop: "free", enhance: 0, exposure: 0, contrast: 0, strokes: [] };

/** The pen's colours (names the canvas knows: the drawing is the picture's own content, not a theme colour). */
export const PEN_COLORS = ["white", "black", "red", "gold", "limegreen", "dodgerblue"] as const;
/** The pen's width: a fraction of the picture's shorter side. */
export const PEN_WIDTH = 0.012;

/** A slider's number: a whole number inside -100..100 (a broken one is 0). */
export function clampAdjust(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** The picture's sides after `turns` quarter turns. */
export function turnedSize(w: number, h: number, turns: number): { w: number; h: number } {
  return turns % 2 === 0 ? { w, h } : { w: h, h: w };
}

/** The biggest centred box of the preset's ratio inside a w × h picture (whole numbers, never outside it, at least 1 px each way). */
export function cropBox(w: number, h: number, preset: CropPreset): { x: number; y: number; w: number; h: number } {
  if (preset === "free") return { x: 0, y: 0, w, h };
  const ratio = RATIO[preset];
  let cw = w;
  let ch = h;
  if (w / h > ratio) cw = Math.max(1, Math.floor(h * ratio));
  else ch = Math.max(1, Math.floor(w / ratio));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
}

/** The canvas filter of the three sliders; «none» while they all rest (so an untouched picture is not redrawn through a filter). */
export function adjustFilter(state: Pick<EditState, "enhance" | "exposure" | "contrast">): string {
  const brightness = 1 + state.exposure / 200;
  const contrast = (1 + state.contrast / 200) * (1 + state.enhance / 400);
  const saturate = 1 + state.enhance / 200;
  const [b, c, s] = [brightness, contrast, saturate].map((v) => v.toFixed(2));
  if (b === "1.00" && c === "1.00" && s === "1.00") return "none";
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

/** Nothing was changed: the original file goes on as it is. */
export function isUntouched(state: EditState): boolean {
  return state.turns === 0 && state.crop === "free" && state.enhance === 0 && state.exposure === 0 && state.contrast === 0 && state.strokes.length === 0;
}

/** The edited picture was redrawn, so it is a JPEG: the name keeps its stem. */
export function editedName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.jpg`;
}
