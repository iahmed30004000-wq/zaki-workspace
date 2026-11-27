import { db } from "@/server/db";
import type { OrgRole } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { ingest, openStored, PENDING_PATH } from "@/server/services/files";
import { sniffChatMedia } from "@/server/files/sniff";
import { actorFeatureOn } from "@/server/services/features";
import { SOUND_MAX_BYTES, SOUND_MAX_COUNT, customSoundUrl } from "@/lib/sound-library/choice";

/**
 * A PERSON'S OWN SOUNDS («إضافة صوت» of the sounds library). It follows the avatar's pattern: a `StoredFile` with `purpose = "SOUND"` (a plain string
 * column: no migration), the bytes sniffed as audio whatever the client claims, a size cap, and a limit on how many one person keeps.
 *
 * THE SOUND BELONGS TO THE PERSON AND IS HEARD BY NOBODY ELSE: every read, list and delete asks «did I upload it?» and nothing else — no rank opens another
 * person's sound, and a miss is «not found», never a hint. Like a picture it stays on the server's disk (never Drive).
 */
export const SOUND_PURPOSE = "SOUND";

export interface MySoundDto {
  id: string;
  name: string;
  size: number;
  url: string;
}

const mine = (userId: string) => ({ uploaderId: userId, purpose: SOUND_PURPOSE, deletedAt: null, path: { not: PENDING_PATH } });

/** The library is a part of «تيليجرام على التلفون»: the new chat screen AND `tgPhone`. */
export async function soundLibraryOn(actor: { orgId: string }): Promise<boolean> {
  return (await actorFeatureOn(actor, "chatLayoutV2")) && (await actorFeatureOn(actor, "tgPhone"));
}

export async function assertSoundLibraryOn(actor: { orgId: string }): Promise<void> {
  if (!(await soundLibraryOn(actor))) throw new NotFoundError("features.off");
}

/** The name on the radio row: the file's name without its ending. */
export function soundDisplayName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return (base || fileName).slice(0, 80);
}

export async function listMySounds(userId: string): Promise<MySoundDto[]> {
  const rows = await db.storedFile.findMany({ where: mine(userId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: SOUND_MAX_COUNT, select: { id: true, name: true, size: true } });
  return rows.map((r) => ({ id: r.id, name: soundDisplayName(r.name), size: r.size, url: customSoundUrl(r.id) }));
}

export async function addMySound(ctx: { orgId: string; orgRole: OrgRole; userId: string }, input: { name: string; bytes: Uint8Array }): Promise<MySoundDto> {
  if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.no_access");
  if (input.bytes.length > SOUND_MAX_BYTES) throw new ForbiddenError("sound.too_large");
  // the chat's own sniffer, told «audio»: the only way to tell an m4a or a webm recording from a video; anything that is not sound is refused
  const sniffed = sniffChatMedia(input.bytes, "AUDIO", input.name);
  if (!sniffed.ok || sniffed.kind !== "AUDIO") throw new ForbiddenError("sound.unsupported");
  if ((await db.storedFile.count({ where: mine(ctx.userId) })) >= SOUND_MAX_COUNT) throw new ForbiddenError("sound.too_many");
  const made = await ingest(ctx, { name: input.name, bytes: input.bytes }, undefined, SOUND_PURPOSE, undefined, { sniffedMime: sniffed.mime, maxBytes: SOUND_MAX_BYTES });
  return { id: made.id, name: soundDisplayName(input.name), size: input.bytes.length, url: customSoundUrl(made.id) };
}

/** One of MY sounds, ready to be read (with ranges: Safari asks for them). Anything else is 404. */
export async function openMySound(userId: string, fileId: string) {
  const row = await db.storedFile.findFirst({ where: { id: fileId, ...mine(userId) }, select: { id: true, orgId: true } });
  if (!row) throw new NotFoundError("files.not_found");
  // the company it was uploaded in, not the one I am in now: the sound is mine, wherever I stand
  return openStored(row.orgId, row.id);
}

export async function deleteMySound(userId: string, fileId: string): Promise<void> {
  const done = await db.storedFile.updateMany({ where: { id: fileId, ...mine(userId) }, data: { deletedAt: new Date() } });
  if (done.count === 0) throw new NotFoundError("files.not_found");
}
