import type { CollagePage } from "@/lib/cards/collage-layout";

/**
 * Browser helpers for the pictures of a product sheet (Q1.2): copy a picture, download it, share it, paint a collage on a canvas, cover a rectangle. All of
 * this runs in the BROWSER: nothing is merged on the server, and the ORIGINAL of a feedback picture never leaves the phone (the rectangles are painted into
 * the pixels before anything is sent).
 */

export interface CoverRect {
  /** 0–1 of the picture's width and height */
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

export function canvasBlob(canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), type, quality));
}

/** A picture fetched from this site (with the session) as a PNG blob, for the clipboard (it takes PNG). */
export async function pngBlobOf(url: string): Promise<Blob> {
  const img = await loadImage(url);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return canvasBlob(c, "image/png");
}

/** «انسخي الصورة»: the clipboard when the browser can; otherwise the picture is downloaded and the answer says so (`"downloaded"`). */
export async function copyImage(blob: Blob, filename: string): Promise<"copied" | "downloaded"> {
  try {
    const ClipboardItemCtor = (globalThis as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
    if (ClipboardItemCtor && navigator.clipboard && "write" in navigator.clipboard) {
      await (navigator.clipboard as unknown as { write: (items: unknown[]) => Promise<void> }).write([new ClipboardItemCtor({ [blob.type || "image/png"]: blob })]);
      return "copied";
    }
  } catch {
    /* fall through to the download */
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

/** A file name safe for every system: no slashes or control characters, a sane length. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "image";
  return `${base}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** «شاركيها»: the phone's share sheet with the files; false when the browser has none (the screen then downloads). */
export async function shareFiles(files: File[], text?: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.share && (!nav.canShare || nav.canShare({ files }))) {
      await nav.share({ files, ...(text ? { text } : {}) });
      return true;
    }
  } catch (err) {
    // the person closed the sheet: nothing to say; anything else falls back to the download
    if (err instanceof DOMException && err.name === "AbortError") return true;
  }
  return false;
}

/** Paints a collage page (from `layoutCollage`) with the loaded pictures; the picture of `placement.source` is `images[placement.source]`. */
export async function renderCollagePage(page: CollagePage, images: HTMLImageElement[], quality = 0.9): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = page.width;
  c.height = page.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, c.width, c.height);
  for (const p of page.placements) ctx.drawImage(images[p.source]!, p.x, p.y, p.w, p.h);
  if (page.caption) {
    ctx.fillStyle = "#111111";
    ctx.font = "bold 40px sans-serif";
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillText(page.caption.text, page.caption.x + page.caption.w, page.caption.y + page.caption.h / 2, page.caption.w);
  }
  return canvasBlob(c, "image/jpeg", quality);
}

/**
 * The cover tool's result: the picture with black rectangles PAINTED into its pixels, as a JPEG. Only this goes to the server; the original (the file the
 * person chose) is never uploaded.
 */
export async function coverPicture(file: Blob, rects: CoverRect[], maxSide = 2400): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ctx.fillStyle = "#000000";
    for (const r of rects) ctx.fillRect(Math.floor(r.x * c.width), Math.floor(r.y * c.height), Math.ceil(r.w * c.width), Math.ceil(r.h * c.height));
    return canvasBlob(c, "image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
