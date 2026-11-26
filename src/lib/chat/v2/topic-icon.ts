/**
 * The forum list of «تيليجرام على التلفون» (pure). A topic's icon has a colour of its own: nothing stores one, so it is worked out from the topic's id — the
 * same topic wears the same colour on every phone, for ever. Only the theme's categorical tokens are used.
 */
export const TOPIC_COLOURS = ["bg-cat-1", "bg-cat-2", "bg-cat-3", "bg-cat-4", "bg-cat-5", "bg-cat-6"] as const;
export type TopicColour = (typeof TOPIC_COLOURS)[number];

export function topicColourOf(id: string): TopicColour {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TOPIC_COLOURS[hash % TOPIC_COLOURS.length]!;
}

/** The discussion kind's default picture: every plain topic has it, so it tells nothing apart. */
const PLAIN_EMOJI = "\u{1F4AC}";

/** What stands on the colour: the topic's own emoji, or the first letter of its name. */
export function topicGlyphOf(topic: { emoji?: string | null; title: string }): string {
  if (topic.emoji && topic.emoji !== PLAIN_EMOJI) return topic.emoji;
  return [...topic.title.trim()][0] ?? "#";
}

/** A move smaller than this is a thumb resting, not a scroll. */
const SCROLL_SLOP_PX = 6;
/** This close to the top the button is always there. */
const TOP_PX = 4;

/** Is the floating button out of the way after the list moved from `before` to `now`? Down hides it, up brings it back. */
export function fabHiddenAfter(before: number, now: number, hidden: boolean): boolean {
  if (now <= TOP_PX) return false;
  const moved = now - before;
  if (Math.abs(moved) < SCROLL_SLOP_PX) return hidden;
  return moved > 0;
}
