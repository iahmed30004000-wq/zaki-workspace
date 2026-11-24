import type { DirectoryPersonDto } from "@/server/chat/dto";

/** One person of the contacts screen: the chat directory's own line (the server decides whether `lastSeenAt` is there at all). */
export type ContactPerson = Pick<DirectoryPersonDto, "userId" | "name" | "jobTitle" | "role" | "avatarUrl" | "lastSeenAt" | "verified">;

const timeOf = (p: ContactPerson): number | null => {
  if (!p.lastSeenAt) return null;
  const at = Date.parse(p.lastSeenAt);
  return Number.isFinite(at) ? at : null;
};

/** Telegram's «مرتّبة حسب آخر ظهور»: the most recently seen first; the people with no known time (hidden, never seen, or the switch is off) after them, by name. A new array. */
export function sortContacts(people: readonly ContactPerson[]): ContactPerson[] {
  return [...people].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** The people whose name or job title contains the words (case and extra spaces ignored). */
export function filterContacts(people: readonly ContactPerson[], query: string): ContactPerson[] {
  const words = query.trim().toLowerCase();
  if (words === "") return [...people];
  return people.filter((p) => p.name.toLowerCase().includes(words) || (p.jobTitle ?? "").toLowerCase().includes(words));
}
