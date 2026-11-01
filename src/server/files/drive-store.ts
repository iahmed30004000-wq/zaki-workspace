import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { driveRequest } from "@/server/services/google";

/**
 * THE LIBRARY ON THE OWNER'S GOOGLE DRIVE (the owner's decision, 2026-10-26): a library file's bytes
 * live in his Drive, in a folder per space under «Zaki Workspace». Drive is storage only: nobody gets
 * a Drive link, every read goes through the app's own permission check and is proxied here.
 *
 * A Drive-stored row has `path = "gdrive:<drive file id>"`; any other path is a file on the server.
 * Folders are found by an app property (`zaki=<tag>`), never by name, so a renamed folder is still
 * found and two folders with one name never mix. Ids are cached per process.
 */

export const DRIVE_PREFIX = "gdrive:";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const ROOT_FOLDER_NAME = "Zaki Workspace";
export const OLD_VERSIONS_FOLDER_NAME = "نسخ قديمة";
export const CHAT_FOLDER_NAME = "مرفقات الدردشة";
export const BACKUP_FOLDER_NAME = "نسخ احتياطي";

export class DriveStoreError extends Error {
  constructor(public readonly step: string, public readonly status?: number) {
    super(`drive.${step}${status ? `_${status}` : ""}`);
  }
}

export function isDrivePath(path: string): boolean {
  return path.startsWith(DRIVE_PREFIX);
}

export function driveIdOf(path: string): string {
  return path.slice(DRIVE_PREFIX.length);
}

/** The name a version carries in Drive: «تقرير.pdf», then «تقرير (نسخة 2).pdf». */
export function driveNameFor(name: string, version: number): string {
  if (version <= 1) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `${base} (نسخة ${version})${ext}`;
}

/** The Drive search for the folder carrying one tag (tags are ids; quotes escaped anyway). */
export function folderQuery(tag: string): string {
  const v = tag.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='zaki' and value='${v}' }`;
}

const folders = new Map<string, Promise<string>>();

/** Forget every cached folder id (a folder the owner removed; tests). */
export function forgetDriveFolders(): void {
  folders.clear();
}

async function jsonOf<T>(res: Response | null, step: string): Promise<T> {
  if (!res) throw new DriveStoreError(`${step}_no_connection`);
  if (!res.ok) throw new DriveStoreError(step, res.status);
  return (await res.json()) as T;
}

async function findOrCreateFolder(orgId: string, tag: string, name: string, parent: string | null): Promise<string> {
  const params = new URLSearchParams({ q: folderQuery(tag), fields: "files(id)", spaces: "drive", pageSize: "1" });
  const found = await jsonOf<{ files?: Array<{ id: string }> }>(await driveRequest(orgId, `${FILES_URL}?${params}`), "find_folder");
  const hit = found.files?.[0]?.id;
  if (hit) return hit;
  const made = await jsonOf<{ id: string }>(
    await driveRequest(orgId, `${FILES_URL}?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties: { zaki: tag }, ...(parent ? { parents: [parent] } : {}) }),
    }),
    "create_folder",
  );
  return made.id;
}

/** One lookup per folder per process, even when several uploads ask at once. */
function folder(orgId: string, tag: string, name: string, parent: string | null): Promise<string> {
  const key = `${orgId}|${tag}`;
  let id = folders.get(key);
  if (!id) {
    id = findOrCreateFolder(orgId, tag, name, parent);
    folders.set(key, id);
    id.catch(() => folders.delete(key));
  }
  return id;
}

export interface DriveSpace {
  id: string;
  name: string;
}

/** «Zaki Workspace» / <space> (a file from before spaces had libraries: the root itself). */
export async function spaceFolder(orgId: string, space: DriveSpace | null): Promise<string> {
  const root = await folder(orgId, `root:${orgId}`, ROOT_FOLDER_NAME, null);
  return space ? folder(orgId, `space:${space.id}`, space.name, root) : root;
}

async function oldVersionsFolder(orgId: string, space: DriveSpace | null): Promise<string> {
  return folder(orgId, `old:${space?.id ?? orgId}`, OLD_VERSIONS_FOLDER_NAME, await spaceFolder(orgId, space));
}

/**
 * Uploads one version (a resumable session: one request for the metadata, one for the bytes) and
 * checks that Drive holds exactly these bytes. Returns the `path` to store.
 */
type DriveUploadSource =
  | { bytes: Uint8Array }
  | { path: string; size: number };

export async function uploadToDrive(
  orgId: string,
  input: { name: string; mimeType: string; space: DriveSpace | null; fileId: string } & DriveUploadSource,
): Promise<string> {
  const parent = await spaceFolder(orgId, input.space);
  const size = "bytes" in input ? input.bytes.length : input.size;
  const start = await driveRequest(orgId, `${UPLOAD_URL}?uploadType=resumable&fields=id,size,md5Checksum`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.mimeType,
      "x-upload-content-length": String(size),
    },
    body: JSON.stringify({ name: input.name, parents: [parent], appProperties: { zakiFile: input.fileId } }),
  });
  if (!start) throw new DriveStoreError("upload_no_connection");
  if (!start.ok) throw new DriveStoreError("upload_start", start.status);
  const session = start.headers.get("location");
  if (!session) throw new DriveStoreError("upload_no_session");
  // the session address is itself the credential: no token on this request
  const body = "bytes" in input ? new Uint8Array(input.bytes) : createReadStream(input.path);
  const put = await fetch(session, {
    method: "PUT",
    headers: { "content-type": input.mimeType, "content-length": String(size) },
    body: body as unknown as BodyInit,
    ...(body instanceof Uint8Array ? {} : { duplex: "half" }),
  } as RequestInit & { duplex?: "half" });
  const made = await jsonOf<{ id: string; size?: string; md5Checksum?: string }>(put, "upload");
  try {
    const md5 = "bytes" in input ? createHash("md5").update(input.bytes).digest("hex") : await md5File(input.path);
    if (Number(made.size) !== size || made.md5Checksum !== md5) throw new DriveStoreError("upload_mismatch");
  } catch (err) {
    await trashOnDrive(orgId, made.id).catch(() => undefined);
    throw err;
  }
  return `${DRIVE_PREFIX}${made.id}`;
}

async function md5File(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** An upload that did not become a file goes to Drive's bin (the owner's, for 30 days). */
export async function trashOnDrive(orgId: string, driveId: string): Promise<void> {
  await jsonOf(
    await driveRequest(orgId, `${FILES_URL}/${encodeURIComponent(driveId)}?fields=id`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    }),
    "trash",
  );
}

/** A version that stepped down moves into «نسخ قديمة» of its space folder (the owner's Drive stays tidy). */
export async function moveToOldVersions(orgId: string, driveId: string, space: DriveSpace | null): Promise<void> {
  const [from, to] = await Promise.all([spaceFolder(orgId, space), oldVersionsFolder(orgId, space)]);
  const params = new URLSearchParams({ addParents: to, removeParents: from, fields: "id" });
  await jsonOf(
    await driveRequest(orgId, `${FILES_URL}/${encodeURIComponent(driveId)}?${params}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    "move_old",
  );
}

/**
 * The bytes (or one inclusive range of them) as a stream, straight from Drive. A file Drive no longer
 * has is «missing», anything else is Drive being unavailable.
 */
export async function readFromDrive(orgId: string, driveId: string, range: { start: number; end: number } | null): Promise<ReadableStream<Uint8Array>> {
  const res = await driveRequest(orgId, `${FILES_URL}/${encodeURIComponent(driveId)}?alt=media`, {
    headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
  });
  if (!res) throw new DriveStoreError("read_no_connection");
  if (res.status === 404) throw new DriveStoreError("read_missing", 404);
  if (!res.ok || !res.body) throw new DriveStoreError("read", res.status);
  // the route has already promised exactly this range (206 + Content-Range): the whole file instead would break it
  if (range && res.status !== 206) throw new DriveStoreError("read_range", res.status);
  return res.body;
}

/**
 * The folder of the chat's files («مرفقات الدردشة»): a chat attachment has no space of its own (it goes with its
 * conversation), so it gets one folder per company beside the spaces' folders. The id carries the company, so two
 * companies on one Drive never share a folder.
 */
export function chatDriveSpace(orgId: string): DriveSpace {
  return { id: `_chat:${orgId}`, name: CHAT_FOLDER_NAME };
}

/**
 * The folder of the database backups («نسخ احتياطي»), one per company beside the spaces' folders (src/server/backup/drive.ts).
 * The id carries the company, so two companies on one Drive never share a folder.
 */
export function backupDriveSpace(orgId: string): DriveSpace {
  return { id: `_backup:${orgId}`, name: BACKUP_FOLDER_NAME };
}

/**
 * Removes a file from Drive for good (not into the bin: a backup that retention retires must free the owner's space). A file Drive
 * no longer has counts as removed.
 */
export async function deleteOnDrive(orgId: string, driveId: string): Promise<void> {
  const res = await driveRequest(orgId, `${FILES_URL}/${encodeURIComponent(driveId)}`, { method: "DELETE" });
  if (!res) throw new DriveStoreError("delete_no_connection");
  if (res.status === 404 || res.status === 204 || res.ok) return;
  throw new DriveStoreError("delete", res.status);
}

/**
 * What Drive holds for one file, read back as a stream and counted (size + SHA-256). The owner's «delete the server
 * copies» step compares this with what the server's copy was when it was moved: the server copy is removed only on a
 * perfect match.
 */
export async function digestDriveFile(orgId: string, driveId: string): Promise<{ size: number; sha256: string }> {
  const stream = await readFromDrive(orgId, driveId, null);
  const hash = createHash("sha256");
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    size += value.byteLength;
  }
  return { size, sha256: hash.digest("hex") };
}

/** The whole file in memory (a caller that needs a buffer; the download route streams instead). */
export async function readAllFromDrive(orgId: string, driveId: string): Promise<Buffer> {
  const stream = await readFromDrive(orgId, driveId, null);
  return Buffer.from(await new Response(stream).arrayBuffer());
}
