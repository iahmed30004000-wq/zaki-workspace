/**
 * «تيليجرام على التلفون» — a picked reaction: its pill is drawn at once (the server answers a moment later), the emoji flies from the bar into it on a
 * small arc, and a short burst of sparks goes off around it. Pure numbers; the page moves them (`components/chat/v2/phone/message-fx.ts`).
 */

export const FLIGHT_FROM_SCALE = 1.4;
export const FLIGHT_TO_SCALE = 0.7;
const ARC_PX = 56;

/** Where the flying emoji is at `t` (0 at the bar, 1 in the pill), by its centre. */
export function flightPoint(from: { x: number; y: number }, to: { x: number; y: number }, t: number): { x: number; y: number; scale: number } {
  const p = Math.min(Math.max(t, 0), 1);
  const eased = 1 - (1 - p) * (1 - p);
  const lift = p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p) * ARC_PX;
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased - lift,
    scale: p === 1 ? FLIGHT_TO_SCALE : FLIGHT_FROM_SCALE + (FLIGHT_TO_SCALE - FLIGHT_FROM_SCALE) * eased,
  };
}

/** The chips with the reaction that is on its way: the same list when there is none or mine is there already. */
export function withPendingReaction<T extends { emoji: string; count: number; mine: boolean }>(reactions: T[], emoji: string | null): T[] {
  if (emoji === null || reactions.some((r) => r.emoji === emoji && r.mine)) return reactions;
  if (reactions.some((r) => r.emoji === emoji)) return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
  return [...reactions, { emoji, count: 1, mine: true } as T];
}

export interface Spark {
  /** the direction and how far it goes */
  dx: number;
  dy: number;
  size: number;
  /** how much of the burst it lives (0..1) */
  life: number;
}

const SPARKS = 18;

export function sparksOf(random: () => number = Math.random): Spark[] {
  return Array.from({ length: SPARKS }, (_, i) => {
    const angle = ((i + random() * 0.6) / SPARKS) * Math.PI * 2;
    const reach = 22 + random() * 30;
    return { dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, size: 1.5 + random() * 2.5, life: 0.35 + random() * 0.45 };
  });
}
