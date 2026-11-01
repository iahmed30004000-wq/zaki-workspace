import { ECONOMY_POLL_FACTOR } from "@/lib/features";

/**
 * «وضع التوفير» on the screen: how long a repeated refresh waits. The shell tells this module once per render (`<EconomyMark>`), and every
 * timer that re-asks the server on its own reads its period through `pollMs(base)`: the base period normally, `ECONOMY_POLL_FACTOR` times
 * longer in economy mode. A timer already running keeps its period until its screen opens again (a page change is enough).
 */
let economy = false;

export function setEconomy(on: boolean): void {
  economy = on;
}

export function economyActive(): boolean {
  return economy;
}

/** The period of a repeated refresh, in milliseconds. */
export function pollMs(baseMs: number): number {
  return economy ? baseMs * ECONOMY_POLL_FACTOR : baseMs;
}
