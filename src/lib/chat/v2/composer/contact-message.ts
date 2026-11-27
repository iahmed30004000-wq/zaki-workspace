import type { ContactPerson } from "@/lib/contacts";
import { ct } from "@/lib/chat/text";
import { profileQrUrl } from "@/lib/chat/v2/qr";

/**
 * «جهة اتصال» in the attach sheet (pure). No new kind of message and no new server door: an ordinary text message with the person's name and the address of
 * their page in the app (`/u/<id>`, which asks for a sign-in, so a stranger who copies it only reaches the login).
 */
export const contactMessage = (name: string, origin: string, userId: string): string => `${ct("tgsheets.contact.message", { name })}\n${profileQrUrl(origin, userId)}`;

interface DirectoryRow {
  userId?: string;
  role?: string;
  lastSeenAt?: string | null;
  verified?: boolean;
  user?: { id?: string; name?: string; jobTitle?: string | null; avatarUrl?: string | null };
}

/** The people of `GET /api/chat/directory?scope=company`, as the contacts screen reads them. */
export function contactsOf(answer: { people?: readonly DirectoryRow[] } | null | undefined): ContactPerson[] {
  return (answer?.people ?? []).flatMap((row) => {
    const userId = row.userId ?? row.user?.id;
    const name = row.user?.name;
    if (!userId || !name) return [];
    return [{ userId, name, jobTitle: row.user?.jobTitle ?? null, role: row.role as ContactPerson["role"], avatarUrl: row.user?.avatarUrl ?? null, lastSeenAt: row.lastSeenAt ?? null, verified: row.verified === true }];
  });
}
