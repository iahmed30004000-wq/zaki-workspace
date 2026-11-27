import { db } from "@/server/db";
import { audit, ForbiddenError, NotFoundError, verifyPassword } from "@/server/auth";
import { usernameSchema } from "@/server/services/credentials";
import { usernameFromName } from "@/lib/username-suggest";
import { Prisma } from "@prisma/client";

/** A free sign-in name made from a person's name: the suggestion itself, or the first of «name2», «name3»… nobody has. "" while the name gives nothing. */
export async function suggestFreeUsername(name: string): Promise<string> {
  const base = usernameFromName(name);
  if (!base) return "";
  const rows = await db.user.findMany({ where: { username: { startsWith: base, mode: "insensitive" } }, select: { username: true }, take: 500 });
  const taken = new Set(rows.map((r) => (r.username ?? "").toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= taken.size + 2; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  return "";
}

export class UsernameError extends Error {
  constructor(readonly key: "accounts.username_taken" | "accounts.username_bot") {
    super(key);
    this.name = "UsernameError";
  }
}

/**
 * A person changes their OWN sign-in name («وهو يقدر يعدلو»). The current password must verify (it is the name they sign in with, and a session left open must
 * not be able to lock them out of their own account); the new name follows the one rule of every username, is free whatever the letter case, and does not end
 * like a bot's («_bot»). Sessions stay open; the next sign-in uses the new name. Written to the audit with the old and the new name.
 */
export async function changeOwnUsername(userId: string, rawUsername: unknown, currentPassword: string): Promise<{ username: string; changed: boolean }> {
  const username = usernameSchema.parse(rawUsername);
  const row = await db.user.findUnique({ where: { id: userId }, select: { username: true, passwordHash: true, memberships: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 1, select: { organizationId: true } } } });
  if (!row) throw new NotFoundError("user.not_found");
  if (!(await verifyPassword(currentPassword, row.passwordHash))) throw new ForbiddenError("password.wrong_current");
  if (row.username === username) return { username, changed: false };
  if (username.endsWith("_bot")) throw new UsernameError("accounts.username_bot");
  const other = await db.user.findFirst({ where: { id: { not: userId }, username: { equals: username, mode: "insensitive" } }, select: { id: true } });
  if (other) throw new UsernameError("accounts.username_taken");
  try {
    await db.user.update({ where: { id: userId }, data: { username } });
  } catch (err) {
    // two people asking for the same name at once: the unique index decides
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UsernameError("accounts.username_taken");
    throw err;
  }
  await audit("auth.username_changed", { actorId: userId, orgId: row.memberships[0]?.organizationId ?? null, target: userId, meta: { from: row.username, to: username } });
  return { username, changed: true };
}
