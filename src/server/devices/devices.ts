import crypto from "node:crypto";
import { db } from "@/server/db";
import { featureOn } from "@/lib/features";

/**
 * THE ANDROID APP OF A PERSON. It is paired once from the site (a signed-in person asks for a key; the site hands it to the app through
 * the link zaki://pair), then the app keeps a live line to the server (/api/device/stream) with that key. Only the key's hash is stored,
 * so a stolen database holds no usable key; removing the device here cuts its line at the next check.
 */
const MAX_DEVICES = 8;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** Pairs a new phone: returns its key, shown ONCE (never stored in the clear). The oldest devices go when a person has too many. */
export async function pairDevice(userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = `zk_${crypto.randomBytes(32).toString("base64url")}`;
  const row = await db.appDevice.create({
    data: { userId, tokenHash: hash(token), name: name.trim().slice(0, 60) || "Android" },
    select: { id: true },
  });
  const all = await db.appDevice.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const surplus = all.slice(MAX_DEVICES).map((d) => d.id);
  if (surplus.length > 0) await db.appDevice.deleteMany({ where: { id: { in: surplus }, userId } });
  return { id: row.id, token };
}

export async function listDevices(userId: string): Promise<PairedDevice[]> {
  return db.appDevice.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, createdAt: true, lastSeenAt: true } });
}

/** Only a person's own device is removed. */
export async function removeDevice(userId: string, id: string): Promise<boolean> {
  const res = await db.appDevice.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

/** The device behind a key, or null (unknown or removed). */
export async function deviceByToken(token: string): Promise<{ id: string; userId: string } | null> {
  if (!token.startsWith("zk_") || token.length > 200) return null;
  return db.appDevice.findUnique({ where: { tokenHash: hash(token) }, select: { id: true, userId: true } });
}

export async function touchDevice(id: string): Promise<void> {
  await db.appDevice.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
}

/** The person is in at least one company that has the switch «الاتصال بتطبيق الأندرويد» on (a person who left gets no line). */
export async function lineAllowed(userId: string): Promise<boolean> {
  const rows = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organization: { select: { settings: true } } },
  });
  return rows.some((r) => featureOn(r.organization.settings, "appConnection"));
}

/** The key out of an `Authorization: Bearer …` header ("" when there is none). */
export function bearerOf(header: string | null): string {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m?.[1] ?? "";
}
