/**
 * W1.5 - the line under a project's title: «N مفتوحة · M منجزة · P٪». `total` is every task the person may open that is not archived (the done ones included),
 * `done` is those of them in a finished column. The old page added the done ones to the total a second time (3 done of 10 read as 3 of 13); this one does not.
 * Pure: a test runs it without a page.
 */
export function projectProgress(total: number, done: number): { open: number; done: number; pct: number } {
  const all = Math.max(0, Math.trunc(total));
  const finished = Math.min(all, Math.max(0, Math.trunc(done)));
  return { open: all - finished, done: finished, pct: all > 0 ? Math.round((finished / all) * 100) : 0 };
}
