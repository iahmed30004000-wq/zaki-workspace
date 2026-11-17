/**
 * A trailing debounce: a burst of calls becomes ONE call, `ms` after the last. `cancel()` drops a pending call (the screen was
 * left). Used by the chat list (F0.6), which used to refetch on every message event of the company.
 */
export function debounced(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
