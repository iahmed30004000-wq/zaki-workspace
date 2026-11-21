/**
 * The reaction palette shown in the chat UI. It must stay identical to the
 * server allow-list (`ALLOWED_REACTIONS` in src/server/services/chat.ts);
 * tests/encoding-hygiene.test.ts fails if the two ever drift apart.
 * Kept in a server-free module so client components can import it.
 */
export const CHAT_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"] as const;

/** A chip under a message as the screen holds it (a subset of the server's `ReactionDto`; `by` is «مين تفاعل»). */
export interface ReactionChip {
  emoji: string;
  count: number;
  mine: boolean;
  by?: readonly { id: string; name: string; avatar?: string | null; me?: true }[];
}

/**
 * S5.6 — the chips that must BURST: a chip that is new, or whose count grew, since the last time the message was drawn. Not the first draw (`prev` is null: opening a
 * chat must not make every reaction jump), not a chip that stands still and not one that lost a reaction.
 */
export function burstedReactions(prev: readonly ReactionChip[] | null, next: readonly ReactionChip[]): string[] {
  if (prev === null) return [];
  const before = new Map(prev.map((r) => [r.emoji, r.count] as const));
  return next.filter((r) => r.count > (before.get(r.emoji) ?? 0)).map((r) => r.emoji);
}

export interface ReactorRow {
  id: string;
  name: string;
  avatar: string | null;
  me: boolean;
  /** the emojis this person put on the message (all of them in the «الكل» list, the one that was asked for otherwise) */
  emojis: string[];
}

/** «مين تفاعل»: the people behind the chips, each once, in the order the chips list them; `emoji` null is every chip, otherwise only the people who used that one. */
export function reactorRows(reactions: readonly ReactionChip[], emoji: string | null): ReactorRow[] {
  const rows = new Map<string, ReactorRow>();
  for (const chip of reactions) {
    if (emoji !== null && chip.emoji !== emoji) continue;
    for (const p of chip.by ?? []) {
      const row = rows.get(p.id) ?? { id: p.id, name: p.name, avatar: p.avatar ?? null, me: p.me === true, emojis: [] };
      row.emojis.push(chip.emoji);
      rows.set(p.id, row);
    }
  }
  return [...rows.values()];
}

/** How many reactions of the chosen chips the list cannot name: a guest sees only himself, a receipt's names are the author's, and the list is capped (the count is the truth). */
export function reactorsHidden(reactions: readonly ReactionChip[], emoji: string | null): number {
  let hidden = 0;
  for (const chip of reactions) {
    if (emoji !== null && chip.emoji !== emoji) continue;
    hidden += Math.max(0, chip.count - (chip.by?.length ?? 0));
  }
  return hidden;
}
