import type { OrgAccessContext } from "@/server/auth";
import { ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { emitRealtime } from "@/server/realtime/emit";
import { sniffMimeType } from "@/server/files/sniff";
import { AVATAR_MAX_BYTES, avatarFileIdOf, avatarUrlOf } from "@/server/services/avatars";
import { ingest } from "@/server/services/files";
import { assertFeatureOn } from "@/server/services/features";
import { loadManaged } from "@/server/chat/groups";

/**
 * «صورة المجموعة»: the picture of a group of topics, drawn instead of the folder emoji. It is a `StoredFile` with the purpose of a face (the same sniffer, the same 2 MB, the same
 * door to read it: `/api/avatars/<id>`), and the group row holds the address. Whoever may arrange the space (its admin, the owner) sets or removes it; a replaced picture is
 * soft-deleted, so nothing stays live on disk without a row pointing at it. The switch `groupPictures` only gates SETTING: pictures already saved keep showing.
 */
const MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

async function retire(fileId: string | null, orgId: string): Promise<void> {
  if (!fileId) return;
  await db.storedFile.updateMany({ where: { id: fileId, orgId, deletedAt: null }, data: { deletedAt: new Date() } }).catch(() => undefined);
}

export async function setGroupPicture(ctx: OrgAccessContext, groupId: string, input: { name: string; bytes: Uint8Array }): Promise<{ imageUrl: string }> {
  await assertFeatureOn(ctx.orgId, "groupPictures");
  const group = await loadManaged(ctx, groupId);
  if (input.bytes.length > AVATAR_MAX_BYTES) throw new ForbiddenError("avatar.too_large");
  const mime = sniffMimeType(input.bytes);
  if (!mime || !MIME.has(mime)) throw new ForbiddenError("avatar.unsupported");
  const made = await ingest({ orgId: ctx.orgId, orgRole: ctx.orgRole, userId: ctx.userId }, { name: input.name, bytes: input.bytes }, undefined, "AVATAR", undefined, { sniffedMime: mime, maxBytes: AVATAR_MAX_BYTES });
  const imageUrl = avatarUrlOf(made.id)!;
  await db.$transaction(async (tx) => {
    await tx.topicGroup.update({ where: { id: groupId }, data: { imageUrl } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: group.spaceId });
  });
  await retire(avatarFileIdOf(group.imageUrl), ctx.orgId);
  return { imageUrl };
}

export async function clearGroupPicture(ctx: OrgAccessContext, groupId: string): Promise<void> {
  await assertFeatureOn(ctx.orgId, "groupPictures");
  const group = await loadManaged(ctx, groupId);
  await db.$transaction(async (tx) => {
    await tx.topicGroup.update({ where: { id: groupId }, data: { imageUrl: null } });
    await emitRealtime(tx, ctx.orgId, "conversation.changed", { spaceId: group.spaceId });
  });
  await retire(avatarFileIdOf(group.imageUrl), ctx.orgId);
}
