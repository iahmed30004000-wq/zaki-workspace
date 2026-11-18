import type { ReaderDto } from "@/server/chat/dto";

const same = (a: readonly ReaderDto[], b: readonly ReaderDto[]): boolean => a.length === b.length && a.every((r, i) => r.userId === b[i]!.userId && r.readAt === b[i]!.readAt && r.name === b[i]!.name && r.avatarUrl === b[i]!.avatarUrl);

/**
 * C2.4 — the readers of each message («who read up to here»), grouped by message, keeping the SAME array for a message whose readers did not change. The
 * bubble is memoized by what it is given: a new array for every message on every read tick elsewhere would draw every bubble that has readers again.
 */
export function stableReaders(previous: ReadonlyMap<string, ReaderDto[]>, readers: readonly ReaderDto[]): Map<string, ReaderDto[]> {
  const grouped = new Map<string, ReaderDto[]>();
  for (const r of readers) {
    const list = grouped.get(r.messageId);
    if (list) list.push(r);
    else grouped.set(r.messageId, [r]);
  }
  for (const [messageId, list] of grouped) {
    const before = previous.get(messageId);
    if (before && same(before, list)) grouped.set(messageId, before);
  }
  return grouped;
}
