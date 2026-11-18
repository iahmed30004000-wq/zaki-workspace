/**
 * «اعمليهم صورة وحدة» (Q1.2): ONE picture from several feedback pictures, built in the browser — nothing is merged on the server. This file is only the
 * LAYOUT, a pure function: it says where each picture goes; the screen paints it on a canvas.
 *
 *  - 2 to 9 pictures; NEVER cropped (a screenshot must stay readable): each is scaled to the column width and keeps its own proportions.
 *  - 2 columns for 2 to 4 pictures, 3 for 5 to 9; each picture goes into the SHORTEST column, in order.
 *  - a white page, 12 px gaps (also around), an optional caption line on top (the name of the product).
 *  - 1080 px wide (1440 with 3 columns). A result taller than 4096 px is split into more pictures (the list is cut in the middle, in order, and each half
 *    is laid out again; a half still too tall is cut again).
 */
export const MIN_PICTURES = 2;
export const MAX_PICTURES = 9;
export const GAP = 12;
export const MAX_PAGE_HEIGHT = 4096;
export const CAPTION_HEIGHT = 72;

export interface PictureSize {
  width: number;
  height: number;
}

export interface Placement {
  /** the picture's place in the list given to THIS page (0-based) */
  index: number;
  /** the picture's place in the whole list given to `layoutCollage` */
  source: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollagePage {
  width: number;
  height: number;
  background: "#ffffff";
  placements: Placement[];
  caption?: { text: string; x: number; y: number; w: number; h: number };
}

export function collageColumns(count: number): 2 | 3 {
  return count >= 5 ? 3 : 2;
}

function layoutOne(sizes: PictureSize[], offset: number, caption: string | undefined, columns: 2 | 3): CollagePage {
  const width = columns === 3 ? 1440 : 1080;
  const colWidth = Math.floor((width - GAP * (columns + 1)) / columns);
  const top = caption ? GAP + CAPTION_HEIGHT : 0;
  const heights = Array.from({ length: columns }, () => top + GAP);
  const placements: Placement[] = [];
  sizes.forEach((s, i) => {
    let col = 0;
    for (let c = 1; c < columns; c++) if (heights[c]! < heights[col]!) col = c;
    const h = Math.max(1, Math.round((colWidth * s.height) / s.width));
    const y = heights[col]!;
    placements.push({ index: i, source: offset + i, x: GAP + col * (colWidth + GAP), y, w: colWidth, h });
    heights[col] = y + h + GAP;
  });
  const height = Math.max(...heights);
  return { width, height, background: "#ffffff", placements, ...(caption ? { caption: { text: caption, x: GAP, y: GAP, w: width - GAP * 2, h: CAPTION_HEIGHT } } : {}) };
}

function layoutRange(sizes: PictureSize[], offset: number, caption: string | undefined, columns: 2 | 3): CollagePage[] {
  const page = layoutOne(sizes, offset, caption, columns);
  if (page.height <= MAX_PAGE_HEIGHT || sizes.length < 2) return [page];
  const mid = Math.ceil(sizes.length / 2);
  return [...layoutRange(sizes.slice(0, mid), offset, caption, columns), ...layoutRange(sizes.slice(mid), offset + mid, caption, columns)];
}

export function layoutCollage(sizes: readonly PictureSize[], opts: { caption?: string } = {}): { columns: 2 | 3; pages: CollagePage[] } {
  if (sizes.length < MIN_PICTURES || sizes.length > MAX_PICTURES) throw new Error("collage.count");
  for (const s of sizes) if (!(s.width > 0 && s.height > 0)) throw new Error("collage.size");
  const columns = collageColumns(sizes.length);
  const caption = opts.caption?.trim() ? opts.caption.trim().slice(0, 80) : undefined;
  return { columns, pages: layoutRange([...sizes], 0, caption, columns) };
}
