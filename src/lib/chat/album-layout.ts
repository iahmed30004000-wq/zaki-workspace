import type { AttachmentDto } from "@/server/chat/dto";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/chat/file-kinds";

/**
 * C3b.3 — the mosaic of a message with several pictures or videos. ONE pure function from the attachments' own `width` / `height` (the server already sends
 * them): no schema, no measuring in the browser, so the virtual list can RESERVE the album's box before a single file has loaded (`albumBox` in
 * `viewport/sizes.ts` is this function's answer) and the bubble draws exactly the same box.
 *
 *   1  one cell, the full box            2  side by side            3  one big over two
 *   4  a 2x2 (equal cells)               5 to 10  rows of two or three, in order, none alone
 *
 * Rows are JUSTIFIED: a row's cells take widths in proportion to their pictures' shapes, so the row has the height that fits them all with no crop at all.
 * Only three limits ever crop a picture, and each is bounded: a very thin or very wide picture is laid out as if it were a little less extreme
 * (`MIN_ASPECT` / `MAX_ASPECT`), a row is never thinner than `MIN_ROW` or taller than `MAX_ROW` of the width, and the 2x2 uses equal cells. A picture is
 * drawn with `object-fit: cover` in its cell, so what is lost is at most `cellCrop` (the viewer always shows the whole picture). A stack that would be taller than
 * `ALBUM_MAX_H` is made NARROWER (same shapes, same crop) instead of squeezed: the box never grows past its limits.
 *
 * Positions are whole pixels, `x` counted from the INLINE START of the box (the right side in Arabic): the first picture sits at the start. The
 * caller draws them as percentages of the box so the album shrinks with a narrow bubble without changing shape.
 */

/** A message holds at most this many files (the composer's and the server's limit: the same number). */
export const ALBUM_MAX = MAX_ATTACHMENTS_PER_MESSAGE;
/** the widest box of an album, in pixels */
export const ALBUM_W = 320;
/** the tallest box of an album (a picture alone is held to `IMAGE_MAX_H` in `sizes.ts`) */
export const ALBUM_MAX_H = 480;
/** the line between two cells */
export const ALBUM_GAP = 2;

/** width / height of a picture that has no size: the same 4:3 `sizes.ts` falls back to */
const FALLBACK_ASPECT = 4 / 3;
/** the most upright and the most wide a picture is laid out as */
const MIN_ASPECT = 0.75;
const MAX_ASPECT = 1.8;
/** a row's height, as a part of the box width */
const MIN_ROW = 0.18;
const MAX_ROW = 0.75;
const MAX_ROW_ALONE = 1;
/** a narrower box than this is not worth drawing: the stack is cut here rather than shrunk forever */
const FLOOR_W = 96;

export interface AlbumSize {
  width?: number;
  height?: number;
}
export interface AlbumCell {
  /** the picture's index in the list given */
  index: number;
  /** pixels from the inline start of the box / from its top */
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AlbumLayout {
  width: number;
  height: number;
  /** how many cells each row has, from the top */
  rows: number[];
  cells: AlbumCell[];
}

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function aspectOf(size: AlbumSize): number {
  const a = valid(size.width) && valid(size.height) ? size.width / size.height : FALLBACK_ASPECT;
  return clamp(a, MIN_ASPECT, MAX_ASPECT);
}

/** How many cells each row has, for `n` pictures (1..10). */
export function albumPlan(n: number): number[] {
  switch (Math.min(ALBUM_MAX, Math.max(0, Math.floor(n)))) {
    case 0: return [];
    case 1: return [1];
    case 2: return [2];
    case 3: return [1, 2];
    case 4: return [2, 2];
    case 5: return [2, 3];
    case 6: return [3, 3];
    case 7: return [3, 2, 2];
    case 8: return [3, 3, 2];
    case 9: return [3, 3, 3];
    default: return [3, 3, 2, 2];
  }
}

function build(aspects: number[], plan: number[], width: number, equal: boolean): AlbumLayout {
  const cells: AlbumCell[] = [];
  const mean = aspects.reduce((a, b) => a + b, 0) / Math.max(1, aspects.length);
  let at = 0;
  let y = 0;
  for (const count of plan) {
    const row = aspects.slice(at, at + count);
    const inner = width - (count - 1) * ALBUM_GAP;
    const weights = equal ? row.map(() => 1) : row;
    const total = weights.reduce((a, b) => a + b, 0);
    // the height that fits the row with no crop (equal cells: the height of the average picture in a cell of that width)
    const natural = equal ? inner / count / clamp(mean, 0.8, 1.5) : inner / row.reduce((a, b) => a + b, 0);
    const height = Math.round(clamp(natural, width * MIN_ROW, width * (count === 1 ? MAX_ROW_ALONE : MAX_ROW)));
    let before = 0;
    row.forEach((_, j) => {
      const start = Math.round((inner * before) / total);
      before += weights[j]!;
      const end = Math.round((inner * before) / total);
      cells.push({ index: at + j, x: start + j * ALBUM_GAP, y, width: end - start, height });
    });
    at += count;
    y += height + ALBUM_GAP;
  }
  return { width, height: Math.max(0, y - ALBUM_GAP), rows: plan, cells };
}

/**
 * The mosaic of up to ten pictures. `width` is the box's widest size (default `ALBUM_W`). An empty list is an empty box; more than ten are cut to ten (the
 * rest are ordinary attachments, see `albumMediaOf`).
 */
export function layoutAlbum(items: readonly AlbumSize[], options: { width?: number; maxHeight?: number } = {}): AlbumLayout {
  const list = items.slice(0, ALBUM_MAX);
  if (list.length === 0) return { width: 0, height: 0, rows: [], cells: [] };
  const aspects = list.map(aspectOf);
  const plan = albumPlan(list.length);
  const equal = list.length === 4;
  const widest = Math.max(FLOOR_W, Math.floor(options.width ?? ALBUM_W));
  const maxHeight = options.maxHeight ?? ALBUM_MAX_H;
  let layout = build(aspects, plan, widest, equal);
  for (let width = widest; layout.height > maxHeight && width > FLOOR_W; ) {
    width = Math.max(FLOOR_W, Math.floor(width * 0.9));
    layout = build(aspects, plan, width, equal);
  }
  return layout;
}

/**
 * How much of a picture a cell hides (0 to 1), when the picture is drawn to COVER the cell. The viewer shows the whole picture, so this is only what the
 * mosaic crops.
 */
export function cellCrop(cell: Pick<AlbumCell, "width" | "height">, size: AlbumSize): number {
  if (!valid(cell.width) || !valid(cell.height)) return 0;
  const picture = valid(size.width) && valid(size.height) ? size.width / size.height : FALLBACK_ASPECT;
  const box = cell.width / cell.height;
  return 1 - Math.min(box / picture, picture / box);
}

/** Only our own attachment address is ever drawn (a message cannot point the page at a remote file). */
export const safeMediaUrl = (url: string): string | undefined => (url.startsWith("/api/chat/attachments/") ? url : undefined);

type MediaLike = Pick<AttachmentDto, "kind" | "mime">;

/** A picture or a video of ours: what an album is made of. */
export function isAlbumMedia(a: MediaLike): boolean {
  return (a.kind === "IMAGE" && a.mime.startsWith("image/")) || (a.kind === "VIDEO" && a.mime.startsWith("video/"));
}

/**
 * The attachments an album is drawn from: the first ten pictures and videos on OUR OWN address, in order. Everything else (a file, a voice note, an address that is
 * not ours) stays an ordinary line under the album. The bubble and the list's estimate both ask THIS function, so they can never disagree about what is in it.
 */
export function albumMediaOf<T extends MediaLike & Pick<AttachmentDto, "url">>(attachments: readonly T[]): T[] {
  return attachments.filter((a) => isAlbumMedia(a) && safeMediaUrl(a.url) !== undefined).slice(0, ALBUM_MAX);
}

/**
 * The composer's tray: how many of `incoming` still fit when `current` files already wait, and how many do not. The send is ONE message with ONE
 * caption, so the tray never holds more than `ALBUM_MAX`; the person is told at pick time, not after the upload.
 */
export function takeRoom<T>(current: number, incoming: readonly T[]): { accepted: T[]; dropped: number } {
  const room = Math.max(0, ALBUM_MAX - Math.max(0, current));
  const accepted = incoming.slice(0, room);
  return { accepted, dropped: incoming.length - accepted.length };
}
