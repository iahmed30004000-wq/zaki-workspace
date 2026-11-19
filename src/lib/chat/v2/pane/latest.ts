/**
 * C2.4 — only the newest of several requests may answer. Each request takes a guard from `latestGuard()`; asking for the next one makes every earlier guard
 * say «no» from then on, so a slow old answer that arrives after a newer one is dropped instead of overwriting it (a call that ended while the answer
 * for the call that started was still on its way).
 */
export function latestGuard(): () => () => boolean {
  let latest = 0;
  return () => {
    const mine = ++latest;
    return () => mine === latest;
  };
}
