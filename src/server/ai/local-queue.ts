import { AiProviderError } from "./provider";

/**
 * «نموذج محلي» — ONE REQUEST AT A TIME. The local model runs on the CPU of the same small machine as the app and the database: two
 * requests at once would only make both slow and starve everything else. So calls to it go through ONE queue per process:
 *
 *   concurrency   1. A second call waits for the first.
 *   depth         at most `maxWaiting` calls wait (default 2). A call that finds the line full is refused AT ONCE with
 *                 `assistant.err_local_busy` («السيرفر مشغول»): nothing is stored, nothing is half-done.
 *   waiting       a call that has waited `maxWaitMs` (default 90 s) without getting its turn gives up with the same answer, so a screen is
 *                 never left hanging behind a slow one. The running call has its own timeout (local-provider.ts).
 *   fairness      first come, first served.
 *
 * ⚠️ The queue lives in the memory of ONE process. 🔧 The app runs as one container; if it is ever scaled to several, the model's own
 *    `OLLAMA_NUM_PARALLEL=1` is the second lock (docs/LOCAL-MODEL.md).
 */

export const DEFAULT_MAX_WAITING = 2;
export const DEFAULT_MAX_WAIT_MS = 90_000;

interface Waiter {
  go: () => void;
  fail: (err: AiProviderError) => void;
}

export class LocalQueue {
  private running = false;
  private readonly waiters: Waiter[] = [];

  constructor(
    readonly maxWaiting: number = DEFAULT_MAX_WAITING,
    readonly maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
  ) {}

  /** Calls waiting for their turn (the running one is not counted). */
  get waiting(): number {
    return this.waiters.length;
  }

  get busy(): boolean {
    return this.running;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new AiProviderError("assistant.err_aborted");
    if (this.running) {
      if (this.waiters.length >= this.maxWaiting) throw new AiProviderError("assistant.err_local_busy");
      await this.wait(signal);
    } else {
      this.running = true;
    }
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Waits for the turn. The turn is handed over with `running` still true, so nobody can slip in between. */
  private wait(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const leave = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
      };
      const onAbort = () => {
        leave();
        reject(new AiProviderError("assistant.err_aborted"));
      };
      const waiter: Waiter = {
        go: () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        fail: (err) => {
          leave();
          reject(err);
        },
      };
      this.waiters.push(waiter);
      timer = setTimeout(() => waiter.fail(new AiProviderError("assistant.err_local_busy")), this.maxWaitMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next.go();
    else this.running = false;
  }
}

/** The one queue of the process. */
export const localQueue = new LocalQueue();
