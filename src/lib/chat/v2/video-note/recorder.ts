import { VIDEO_NOTE_MAX_MS } from "./limits";
import { pickVideoMime, type VideoTake } from "./model";

/**
 * The camera of a round video message: `MediaRecorder` over the front camera and the microphone. It stops by itself at a minute or when
 * the page is hidden (the take is handed over, never lost), and it ALWAYS closes the camera and the microphone — on stop, on cancel, on
 * a hidden page, when the device takes the camera away, and ALSO when the person let go while the browser was still asking (the stream
 * that arrives after that is closed at once).
 */
export type CameraError = "cam.denied" | "cam.unavailable" | "cam.unsupported";

export interface VideoRecorderOptions {
  /** elapsed ms, about every 100 ms */
  onTick?: (elapsedMs: number) => void;
  /** it stopped by itself (the minute, a hidden page, the camera taken away); `take` null: nothing was captured */
  onAutoStop?: (take: VideoTake | null) => void;
}

/** a recorder that never says it stopped does not leave the take hanging (the camera is closed before the wait either way) */
const STOP_WAIT_MS = 3000;
const VIDEO_BITS = 1_000_000;
const AUDIO_BITS = 64_000;

export class VideoNoteRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private chunks: Blob[] = [];
  private cancelled = false;
  private readonly onHidden: () => void;

  constructor(private readonly opts: VideoRecorderOptions = {}) {
    this.onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      this.autoStop();
    };
  }

  get elapsedMs(): number {
    return this.recorder ? Date.now() - this.startedAt : 0;
  }

  /** Opens the camera and starts the take; answers the stream to show, or null when it was cancelled while the browser was asking. */
  async start(): Promise<MediaStream | null> {
    const mimeType = typeof MediaRecorder === "undefined" ? null : pickVideoMime((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) throw cameraError("cam.unsupported");
    this.cancelled = false;
    // listening BEFORE the question: a page hidden while it is open closes whatever the answer brings
    document.addEventListener("visibilitychange", this.onHidden);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
    } catch (err) {
      this.release();
      const name = (err as DOMException)?.name;
      throw cameraError(name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError" ? "cam.unavailable" : "cam.denied");
    }
    if (this.cancelled) {
      closeTracks(stream);
      return null;
    }
    this.stream = stream;
    this.chunks = [];
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      recorder.start(250);
      this.recorder = recorder;
    } catch {
      this.release();
      throw cameraError("cam.unsupported");
    }
    this.startedAt = Date.now();
    // a call or another app that takes the camera ends the take, which is kept
    for (const track of stream.getTracks()) track.addEventListener?.("ended", () => this.autoStop());
    this.timer = setInterval(() => {
      this.opts.onTick?.(this.elapsedMs);
      if (this.elapsedMs >= VIDEO_NOTE_MAX_MS) this.autoStop();
    }, 100);
    return stream;
  }

  private autoStop(): void {
    if (this.recorder) {
      void this.stop().then((take) => this.opts.onAutoStop?.(take));
      return;
    }
    // still asking for the camera: there is nothing to keep
    if (!this.cancelled && !this.stream) {
      this.cancel();
      this.opts.onAutoStop?.(null);
    }
  }

  /** Stops and hands the take over (null: nothing captured). The camera is closed before this answers. */
  async stop(): Promise<VideoTake | null> {
    const recorder = this.recorder;
    if (!recorder) {
      this.cancel();
      return null;
    }
    const durationMs = Math.min(VIDEO_NOTE_MAX_MS, this.elapsedMs);
    this.recorder = null; // a second stop (the clock and a tap at once) answers null
    const chunks = this.chunks;
    const type = recorder.mimeType;
    const blob = new Promise<Blob | null>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        resolve(chunks.length > 0 ? new Blob(chunks, { type }) : null);
      };
      const giveUp = setTimeout(done, STOP_WAIT_MS);
      recorder.onstop = done;
      if (recorder.state === "inactive") done();
      else recorder.stop();
    });
    // what was gathered is the recorder's already: closing the tracks now loses nothing and leaves no light on
    this.release();
    const made = await blob;
    if (!made) return null;
    return { blob: made, mime: type.split(";")[0] || "video/webm", durationMs };
  }

  /** Throws the take away and closes the camera, whatever stage it is in. */
  cancel(): void {
    this.cancelled = true;
    const recorder = this.recorder;
    this.recorder = null;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // already gone
    }
    this.release();
  }

  private release(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onHidden);
    if (this.stream) closeTracks(this.stream);
    this.stream = null;
  }
}

function closeTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function cameraError(key: CameraError): Error {
  const e = new Error(key);
  e.name = key;
  return e;
}
