import { classifyFile } from "@/lib/chat/file-kinds";

/**
 * C2.5 — the files that arrive by paste and by drop, before anything is uploaded. Pure: the composer hands over what the browser gave it.
 *
 * - A paste with an IMAGE (a screenshot, «copy image») opens the send dialog (preview, caption, «ابعتها كملف»). A paste that also carries TEXT (a cell copied
 *   from a sheet carries both) is a text paste: the words go in the box as the browser does it.
 * - A drop on the pane shows two zones: «ابعت كصور» keeps each file's own kind (pictures and videos are compressed and previewed), «ابعت كملفات» sends the
 *   bytes as they are (no compression; the server still decides the kind from the bytes, so nothing here is a new door).
 */
export type DropMode = "media" | "files";

export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export interface ClipboardLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<ClipboardItemLike> | null;
  getData?: (format: string) => string;
}

/** The images of a paste, in order; none when the paste carries words. */
export function pastedImages(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];
  let text = "";
  try {
    text = data.getData?.("text/plain") ?? "";
  } catch {
    text = "";
  }
  if (text.trim()) return [];
  const out: File[] = [];
  const seen = new Set<File>();
  const add = (file: File | null | undefined) => {
    if (!file || seen.has(file) || classifyFile(file) !== "IMAGE") return;
    seen.add(file);
    out.push(file);
  };
  for (const file of Array.from(data.files ?? [])) add(file);
  for (const item of Array.from(data.items ?? [])) if (item.kind === "file") add(item.getAsFile());
  return out;
}

/** Is a drag carrying files (and not a selection of text or a link)? Only then the two zones are drawn. */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes("Files");
}

export interface DroppedFile {
  file: File;
  /** sent as the bytes they are: no compression, declared a plain file */
  asFile: boolean;
}

interface DropTargetLike {
  closest?: (selector: string) => { getAttribute: (name: string) => string | null } | null;
  parentElement?: DropTargetLike | null;
}

/**
 * What a drop on the two zones means: the zone the files were let go on, and the files. Null outside the zones or with no files. Read AT ONCE, inside the drop event
 * (the browser empties the event's files when it ends). A drop's target can be a text node, which has no `closest`: its parent is asked.
 */
export function dropOnZone(target: unknown, files: ArrayLike<File> | null | undefined): { zone: "media" | "files"; files: File[] } | null {
  const hit = target as DropTargetLike | null | undefined;
  const element = hit?.closest ? hit : hit?.parentElement;
  const zone = element?.closest?.("[data-drop-zone]")?.getAttribute("data-drop-zone");
  if (zone !== "media" && zone !== "files") return null;
  const list = Array.from(files ?? []);
  return list.length ? { zone, files: list } : null;
}

export function forDropMode(files: ArrayLike<File>, mode: DropMode): DroppedFile[] {
  return Array.from(files).map((file) => ({ file, asFile: mode === "files" }));
}

/**
 * The files of a paste that carries no words and no picture (a PDF copied in the file manager): they go to the tray as plain files, the way a pick from the
 * «ملف» menu does. A paste with a picture is the send dialog's, a paste with words is the browser's.
 */
export function pastedDocuments(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];
  let text = "";
  try {
    text = data.getData?.("text/plain") ?? "";
  } catch {
    text = "";
  }
  if (text.trim()) return [];
  const all = Array.from(data.files ?? []);
  if (all.length === 0 || all.some((file) => classifyFile(file) === "IMAGE")) return [];
  return all;
}
