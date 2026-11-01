import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/server/ai/provider";
import { LocalQueue } from "@/server/ai/local-queue";

/**
 * «نموذج محلي» — ONE REQUEST AT A TIME (src/server/ai/local-queue.ts): concurrency 1, a line of at most `maxWaiting`, a clear «busy» when it
 * is full or when the wait is too long, first come first served, and a failed call never leaves the line stuck.
 */

afterEach(() => vi.useRealTimers());

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const keyOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as AiProviderError).key);

describe("concurrency 1", () => {
  it("never runs two calls at once and serves them in the order they came", async () => {
    const q = new LocalQueue(5, 60_000);
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred()];
    const job = (name: string, i: number) =>
      q.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(`start ${name}`);
        await gates[i]!.promise;
        order.push(`end ${name}`);
        active -= 1;
        return name;
      });
    const a = job("a", 0);
    const b = job("b", 1);
    const c = job("c", 2);
    await Promise.resolve();
    expect(order).toEqual(["start a"]);
    expect(q.busy).toBe(true);
    expect(q.waiting).toBe(2);
    gates[0]!.resolve();
    await a;
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start a", "end a", "start b"]);
    gates[1]!.resolve();
    gates[2]!.resolve();
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(peak).toBe(1);
    expect(q.busy).toBe(false);
    expect(q.waiting).toBe(0);
  });

  it("returns the value of the call and passes its error on, and a failure frees the line", async () => {
    const q = new LocalQueue(1, 60_000);
    await expect(q.run(async () => 7)).resolves.toBe(7);
    await expect(
      q.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(q.busy).toBe(false);
    await expect(q.run(async () => "next")).resolves.toBe("next");
  });
});

describe("a full line is «busy», at once", () => {
  it("the third call of a line of one waiting is refused immediately and nothing of it runs", async () => {
    const q = new LocalQueue(1, 60_000);
    const gate = deferred();
    const ran: string[] = [];
    const first = q.run(async () => {
      ran.push("first");
      await gate.promise;
    });
    const second = q.run(async () => {
      ran.push("second");
    });
    const third = q.run(async () => {
      ran.push("third");
    });
    expect(await keyOf(third)).toBe("assistant.err_local_busy");
    gate.resolve();
    await Promise.all([first, second]);
    expect(ran).toEqual(["first", "second"]);
  });

  it("with a line of zero, a call that finds the model busy is refused at once", async () => {
    const q = new LocalQueue(0, 60_000);
    const gate = deferred();
    const first = q.run(() => gate.promise);
    expect(await keyOf(q.run(async () => 1))).toBe("assistant.err_local_busy");
    gate.resolve();
    await first;
    await expect(q.run(async () => 2)).resolves.toBe(2);
  });

  it("a call that waited too long gives up with «busy» and leaves the line", async () => {
    vi.useFakeTimers();
    const q = new LocalQueue(2, 5_000);
    const gate = deferred();
    const first = q.run(() => gate.promise);
    const second = keyOf(q.run(async () => "never"));
    expect(q.waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await second).toBe("assistant.err_local_busy");
    expect(q.waiting).toBe(0);
    gate.resolve();
    await first;
    expect(q.busy).toBe(false);
  });
});

describe("aborting", () => {
  it("a call that is already aborted does not start; one that is waiting leaves the line without running", async () => {
    const q = new LocalQueue(2, 60_000);
    const dead = new AbortController();
    dead.abort();
    expect(await keyOf(q.run(async () => 1, dead.signal))).toBe("assistant.err_aborted");
    expect(q.busy).toBe(false);

    const gate = deferred();
    const first = q.run(() => gate.promise);
    const waiter = new AbortController();
    let ran = false;
    const second = keyOf(
      q.run(async () => {
        ran = true;
      }, waiter.signal),
    );
    expect(q.waiting).toBe(1);
    waiter.abort();
    expect(await second).toBe("assistant.err_aborted");
    expect(q.waiting).toBe(0);
    gate.resolve();
    await first;
    expect(ran).toBe(false);
    expect(q.busy).toBe(false);
  });
});
