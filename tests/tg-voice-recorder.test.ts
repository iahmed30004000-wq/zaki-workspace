import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** «إيقاف مؤقت» of a voice note (`tgPhone`): the recorder really pauses (nothing is recorded, no time is counted), hands over what it has to listen to, and goes on. */

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  pending = "";
  constructor(public stream: unknown, public opts: { mimeType: string }) {
    FakeRecorder.last = this;
  }
  get mimeType() {
    return this.opts.mimeType;
  }
  start() {
    this.state = "recording";
  }
  say(text: string) {
    if (this.state === "recording") this.pending += text;
  }
  flush(extra = "") {
    const data = this.pending + extra;
    this.pending = "";
    this.ondataavailable?.({ data: new Blob([data]) });
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  requestData() {
    setTimeout(() => this.flush(), 0);
  }
  stop() {
    this.state = "inactive";
    this.flush("|END");
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };
let hidden: (() => void) | null = null;
const doc = {
  visibilityState: "visible",
  addEventListener: vi.fn((_: string, fn: () => void) => (hidden = fn)),
  removeEventListener: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.last = null;
  hidden = null;
  doc.visibilityState = "visible";
  track.stop.mockClear();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started(opts: Record<string, unknown> = {}) {
  const { VoiceRecorder } = await import("@/lib/chat/voice-recorder");
  const rec = new VoiceRecorder(opts);
  await rec.start();
  return rec;
}

describe("pause and resume", () => {
  it("pause stops the clock and the capture, and hands over everything recorded so far to listen to", async () => {
    const rec = await started();
    FakeRecorder.last!.say("AAA");
    vi.advanceTimersByTime(2000);
    const flushing = rec.pause();
    await vi.advanceTimersByTimeAsync(10);
    const part = await flushing;
    expect(FakeRecorder.last!.state).toBe("paused");
    expect(rec.paused).toBe(true);
    expect(rec.recording).toBe(true);
    expect(await part!.blob.text()).toBe("AAA");
    expect(part!.mime).toBe("audio/webm");
    expect(part!.durationMs).toBeGreaterThanOrEqual(2000);
    expect(part!.durationMs).toBeLessThan(2100);
    FakeRecorder.last!.say("LOST");
    vi.advanceTimersByTime(60_000);
    expect(rec.elapsedMs).toBeLessThan(2100);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("resume goes on: the take that is sent holds both parts and only the recorded time", async () => {
    const onTick = vi.fn();
    const rec = await started({ onTick });
    FakeRecorder.last!.say("AAA");
    vi.advanceTimersByTime(1000);
    const flushing = rec.pause();
    await vi.advanceTimersByTimeAsync(10);
    await flushing;
    onTick.mockClear();
    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
    expect(rec.resume()).toBe(true);
    expect(FakeRecorder.last!.state).toBe("recording");
    expect(rec.paused).toBe(false);
    FakeRecorder.last!.say("BBB");
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalled();
    const take = await rec.stop();
    expect(await take!.blob.text()).toBe("AAABBB|END");
    expect(take!.durationMs).toBeGreaterThanOrEqual(2000);
    expect(take!.durationMs).toBeLessThan(2200);
    expect(track.stop).toHaveBeenCalled();
  });

  it("a stop while paused sends what was recorded; cancel frees the microphone", async () => {
    const rec = await started();
    FakeRecorder.last!.say("AAA");
    vi.advanceTimersByTime(800);
    const flushing = rec.pause();
    await vi.advanceTimersByTimeAsync(10);
    await flushing;
    vi.advanceTimersByTime(10_000);
    const take = await rec.stop();
    expect(await take!.blob.text()).toBe("AAA|END");
    expect(take!.durationMs).toBeLessThan(900);
    const other = await started();
    other.cancel();
    expect(other.paused).toBe(false);
  });

  it("the paused time never counts toward the 5-minute cap; a hidden page still closes the microphone and keeps the take", async () => {
    const onAutoStop = vi.fn();
    const rec = await started({ onAutoStop });
    FakeRecorder.last!.say("A");
    const flushing = rec.pause();
    await vi.advanceTimersByTimeAsync(10);
    await flushing;
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(onAutoStop).not.toHaveBeenCalled();
    doc.visibilityState = "hidden";
    hidden!();
    await vi.advanceTimersByTimeAsync(10);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(await (onAutoStop.mock.calls[0]![0] as { blob: Blob }).blob.text()).toBe("A|END");
    expect(track.stop).toHaveBeenCalled();
  });

  it("pause and resume do nothing when there is nothing to pause or resume", async () => {
    const rec = await started();
    expect(rec.resume()).toBe(false);
    rec.cancel();
    expect(await rec.pause()).toBeNull();
    expect(rec.resume()).toBe(false);
  });
});
