/**
 * Client-side image compression before a chat upload (FILES-VOICE): the phone's camera
 * produces 4000×3000 photos of several MB; the composer resizes them so the longest side is
 * at most 1600 px at JPEG/WebP quality ~0.8, which keeps a readable photo under ~300 KB.
 * Pure browser code: `createImageBitmap` with `imageOrientation: "from-image"` keeps the
 * EXIF orientation right. GIF is skipped (animation would die in a canvas) and small files
 * are sent as they are.
 */

export const MAX_SIDE = 1600;
/** C4.1 «جودة الصور المرسلة: عالية» (a choice of this device): the longest side may be twice as long. */
export const HIGH_MAX_SIDE = 3200;

/** The longest side a picture is kept to for the device's choice («عادية» is today's 1600 px). */
export function maxSideFor(quality: string | undefined): number {
  return quality === "high" ? HIGH_MAX_SIDE : MAX_SIDE;
}
export const QUALITY = 0.8;
/** Below this a compression buys nothing worth the wait. */
export const SKIP_BELOW_BYTES = 300 * 1024;

export type CompressedImage = { blob: Blob; width: number; height: number; mime: string };

/** GIFs (and anything the browser cannot decode) go up as they are. */
export async function compressImage(file: Blob, fileName = "", opts: { maxSide?: number } = {}): Promise<CompressedImage | null> {
  if (file.size < SKIP_BELOW_BYTES) return null;
  const type = (file as Blob & { type?: string }).type ?? "";
  if (type === "image/gif" || fileName.toLowerCase().endsWith(".gif")) return null;
  if (!type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(fileName)) return null;

  let source: ImageBitmap;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null; // undecodable (e.g. HEIC without native support): upload the original, the server sniffs it
  }
  try {
    const longest = Math.max(source.width, source.height);
    const limit = opts.maxSide ?? MAX_SIDE;
    const scale = longest > limit ? limit / longest : 1;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    const targetMime = supportsWebP() ? "image/webp" : "image/jpeg";
    const blob = await canvas.convertToBlob({ type: targetMime, quality: QUALITY });
    const mime = blob.type || targetMime;
    return { blob, width, height, mime };
  } catch {
    return null;
  } finally {
    source.close();
  }
}

function supportsWebP(): boolean {
  // Safari's toBlob/convertToBlob accepts image/webp since 17; older ones silently fall back to png,
  // which the server refuses — so jpeg is the safe target when webp was not proven.
  return typeof OffscreenCanvas !== "undefined";
}
