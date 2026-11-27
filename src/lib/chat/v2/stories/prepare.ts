/**
 * What a picked file goes through in the browser before it is posted as a story.
 *
 * ⚠️ A phone's photo carries where it was taken (EXIF). 🔧 A picture is ALWAYS drawn again on a canvas, which keeps the pixels and
 * drops everything written beside them; one the browser cannot redraw is refused rather than sent as it is. A GIF carries no such
 * record and would lose its movement, so it goes as it is. A video goes as it is (the same as a video sent in a chat).
 */
export const STORY_IMAGE_MAX_SIDE = 1920;
const QUALITY = 0.86;

/** The size a picture is drawn at: its own, or shrunk until the longest side fits. */
export function storyImageSize(width: number, height: number, maxSide: number = STORY_IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareStoryImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  const source = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = storyImageSize(source.width, source.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("stories.unsupported");
    ctx.drawImage(source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("stories.unsupported");
    return new File([blob], "story.jpg", { type: "image/jpeg" });
  } finally {
    source.close();
  }
}

/** A picked video's length in ms; undefined when the browser cannot tell (the server and the viewer hold the cap either way). */
export function videoDurationOf(url: string, timeoutMs = 5000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : undefined);
    video.onerror = () => finish(undefined);
    video.src = url;
  });
}
