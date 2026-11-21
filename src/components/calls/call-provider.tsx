"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DisconnectReason, LocalAudioTrack, LocalTrack, Participant, Room, Track as LkTrack } from "livekit-client";
import { ct } from "@/lib/chat/text";
import { AWAY_TOPIC, decodeAway, encodeAway, micHeld, type MicFacts } from "@/lib/calls/mic";
import { isDrop, isFresh, MAX_REJOINS, miniVisible, rejoinDelayMs } from "@/lib/calls/session";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi, callErrorText, type CallView } from "./call-api";
import { ensurePush } from "./push-client";

/**
 * THE CALL KEEPER — one live call per tab, kept above every page of the app (mounted in the (app) layout), so the call
 * goes on while the person opens the chat, a task, anything: nothing ends it but «اطلع», being taken out, or the call
 * ending. Away from the call's page it shrinks to a small window in the corner (the picture, the microphone, back to
 * the call, leave), with picture-in-picture where the browser has it. A drop by the network (the phone asleep, a
 * changed network) is joined again quietly, a few times with a growing pause. The voices play from here, so they never
 * stop when a page changes.
 *
 * The calls library (`livekit-client`) and the picture code that uses it are NOT part of the page: they are one lazy chunk,
 * fetched by `loadCallLibs()` when a call starts (`join`) or rings (`prefetch`), so a signed-in page that never calls carries none
 * of it (F1.3). Everything below that touches the library runs after that load: there is a room only after it.
 *
 * The connection favours the voice: adaptive stream and dynacast, simulcast layers, Opus speech with DTX and RED, a
 * muted microphone kept open; the picture degrades first when the network weakens.
 *
 * Stepping out to another app on a phone: the call asks the phone to stay (its floating picture window where the
 * browser opens one by itself, the system's call controls), the others see «برّا التطبيق» on the person's picture, and
 * a microphone the phone stopped or silenced meanwhile is started again the moment the person is back, with «رجع
 * المايك» — never left silently off; if the phone still refuses, a button says so and starts it with one tap.
 */

export type CallPhase = "idle" | "connecting" | "in" | "lost" | "left" | "ended" | "removed" | "denied";

interface CallState {
  callId: string | null;
  phase: CallPhase;
  error: string;
  reconnecting: boolean;
  needsAudioTap: boolean;
  /** the phone stopped or silenced the microphone the person left on (see src/lib/calls/mic.ts) */
  micHeld: boolean;
}

export interface CallApi {
  state: CallState;
  room: Room | null;
  /** everybody in the room, the person first */
  everyone: Participant[];
  /** the people who stepped out to another app on their phone */
  away: ReadonlySet<string>;
  /** start a microphone the phone took away again (a tap helps where the phone wants one) */
  reviveMic: () => Promise<boolean>;
  /** the call's picture in the browser's floating window, where it has one */
  canPip: boolean;
  pip: () => void;
  /** `opts.mic: false`: enter with the microphone (and camera) off, like a joiner of a topic's call; the default is on */
  join: (callId: string, video: boolean, opts?: { mic?: boolean }) => Promise<void>;
  leave: () => Promise<void>;
  toggle: (what: "mic" | "cam" | "screen") => Promise<void>;
  startAudio: () => Promise<void>;
  /** fetch the pass and warm the connection while the phone rings, so «ردّ» is instant */
  prefetch: (callId: string) => void;
}

const CallContext = React.createContext<CallApi | null>(null);

export function useCall(): CallApi {
  const api = React.useContext(CallContext);
  if (!api) throw new Error("useCall outside <CallProvider>");
  return api;
}

/** The call keeper, or null outside the app's frame (a page rendered on its own, a test). */
export function useOptionalCall(): CallApi | null {
  return React.useContext(CallContext);
}

type LiveKit = typeof import("livekit-client");
type Media = typeof import("./call-media");
interface CallLibs {
  lk: LiveKit;
  media: Media;
}

let callLibs: CallLibs | null = null;
let callLibsLoading: Promise<CallLibs> | null = null;

/** The calls library and the call screen's picture code, loaded once, on demand. A failed load can be tried again. */
export function loadCallLibs(): Promise<CallLibs> {
  if (callLibs) return Promise.resolve(callLibs);
  if (!callLibsLoading) {
    callLibsLoading = Promise.all([import("livekit-client"), import("./call-media")]).then(
      ([lk, media]) => (callLibs = { lk, media }),
      (e: unknown) => {
        callLibsLoading = null;
        throw e;
      },
    );
  }
  return callLibsLoading;
}

/** The calls library, for code that only runs once a room exists (a room is made after `loadCallLibs()`). */
function livekit(): LiveKit {
  if (!callLibs) throw new Error("the calls library is not loaded yet");
  return callLibs.lk;
}

const MEMO_KEY = "zk-active-call";

/** The call this tab is in, kept across a reload of the page (switching space reloads it): {id, video, mic}. */
function remember(call: { id: string; video: boolean; mic: boolean } | null): void {
  try {
    if (call) sessionStorage.setItem(MEMO_KEY, JSON.stringify(call));
    else sessionStorage.removeItem(MEMO_KEY);
  } catch {
    // private window: the call still works, only a reload forgets it
  }
}

function remembered(): { id: string; video: boolean; mic: boolean } | null {
  try {
    const raw = sessionStorage.getItem(MEMO_KEY);
    const v = raw ? (JSON.parse(raw) as { id?: unknown; video?: unknown; mic?: unknown }) : null;
    return v && typeof v.id === "string" ? { id: v.id, video: v.video === true, mic: v.mic !== false } : null;
  } catch {
    return null;
  }
}

function newRoom(lk: LiveKit): Room {
  const { AudioPresets, Room, ScreenSharePresets, VideoPresets } = lk;
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, facingMode: "user" },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      // VP9 where the browser has it, VP8 for the others (and for whoever cannot decode VP9)
      videoCodec: "vp9",
      backupCodec: { codec: "vp8" },
      // a shared screen is text: sharp, at a calm frame rate
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      audioPreset: AudioPresets.speech,
      dtx: true,
      red: true,
      // a muted microphone stays open: unmuting is instant, with no new permission prompt
      stopMicTrackOnMute: false,
    },
  });
}

interface Pass {
  url: string;
  token: string;
  /** the owner's switch «تنقية صوت المكالمات» (src/components/calls/noise-filter.ts) */
  noiseFilter?: boolean;
}

/**
 * The microphone cleaned of noise, when the owner's switch is on: the filter is loaded only then (its model stays off
 * the page otherwise), and anything that fails leaves the voice as the browser captured it.
 */
async function cleanMic(track: LocalTrack | undefined): Promise<void> {
  if (!track || track.kind !== livekit().Track.Kind.Audio) return;
  const { canFilterNoise, noiseFilter, NOISE_FILTER_NAME } = await import("./noise-filter");
  if (!canFilterNoise() || track.getProcessor()?.name === NOISE_FILTER_NAME) return;
  await (track as LocalAudioTrack).setProcessor(noiseFilter()).catch(() => undefined);
}

/** What the phone did to this call's microphone, read for the rules in src/lib/calls/mic.ts. */
function micFactsOf(room: Room): MicFacts {
  const pub = room.localParticipant.getTrackPublication(livekit().Track.Source.Microphone);
  const track = pub?.track as LocalTrack | undefined;
  // the microphone itself, not the noise filter's output (which stays «live» when the phone takes the microphone)
  const filtered = track?.getProcessor() as { sourceTrack?: MediaStreamTrack } | undefined;
  const capture = filtered?.sourceTrack ?? track?.mediaStreamTrack;
  return {
    published: !!track,
    chosenMute: !!pub?.isMuted,
    readyState: capture?.readyState === "live" ? "live" : "ended",
    silenced: !!capture?.muted,
    upstreamPaused: !!track?.isUpstreamPaused,
  };
}

const MEDIA_ACTIONS = ["enterpictureinpicture", "togglemicrophone", "togglecamera", "hangup"] as const;

function setMediaAction(action: (typeof MEDIA_ACTIONS)[number], handler: (() => void) | null): void {
  try {
    navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
  } catch {
    // this browser has no such action: nothing to do
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const toast = useOptionalToast();
  const pathname = usePathname();
  const [state, setState] = React.useState<CallState>({ callId: null, phase: "idle", error: "", reconnecting: false, needsAudioTap: false, micHeld: false });
  const [away, setAway] = React.useState<ReadonlySet<string>>(new Set());
  const pipRef = React.useRef<HTMLVideoElement | null>(null);
  const roomRef = React.useRef<Room | null>(null);
  const joining = React.useRef(false);
  const lastVideo = React.useRef(false);
  // whether the person's microphone is open: a joiner of a topic's call starts muted, and a quiet rejoin keeps what they chose
  const lastMic = React.useRef(true);
  const rejoins = React.useRef(0);
  const prefetched = React.useRef<{ callId: string; pass: Pass; at: number } | null>(null);
  // the page is going away (a reload, switching space): the disconnect that follows is not a choice
  const unloading = React.useRef(false);
  React.useEffect(() => {
    const going = () => {
      unloading.current = true;
    };
    window.addEventListener("pagehide", going);
    window.addEventListener("beforeunload", going);
    return () => {
      window.removeEventListener("pagehide", going);
      window.removeEventListener("beforeunload", going);
    };
  }, []);
  // every change in the room (somebody came, a camera went on) draws again
  const [, setTick] = React.useState(0);
  const redraw = React.useCallback(() => setTick((n) => n + 1), []);
  const patch = React.useCallback((p: Partial<CallState>) => setState((s) => ({ ...s, ...p })), []);

  const say = React.useCallback((text: string) => {
    if (toast) toast.toast(text, "error");
  }, [toast]);

  const passFor = React.useCallback(async (callId: string): Promise<Pass> => {
    const warm = prefetched.current;
    prefetched.current = null;
    if (warm && warm.callId === callId && isFresh(warm.at, Date.now())) return warm.pass;
    return callApi<Pass>(`/api/calls/${encodeURIComponent(callId)}/token`, {});
  }, []);

  const join = React.useCallback(async (callId: string, video: boolean, opts?: { mic?: boolean }) => {
    if (joining.current) return;
    if (roomRef.current && state.callId === callId && (state.phase === "in" || state.phase === "connecting")) return;
    joining.current = true;
    lastVideo.current = video;
    const mic = opts?.mic !== false;
    lastMic.current = mic;
    // one call at a time: a new one closes the old one
    const old = roomRef.current;
    roomRef.current = null;
    if (old) await old.disconnect().catch(() => undefined);
    setState({ callId, phase: "connecting", error: "", reconnecting: false, needsAudioTap: false, micHeld: false });
    setAway(new Set());
    // the pass is asked for while the calls library arrives (its own chunk: no page carries it until a call starts or rings)
    const passAsked = passFor(callId);
    passAsked.catch(() => undefined);
    let libs: CallLibs;
    try {
      libs = await loadCallLibs();
    } catch {
      // the chunk did not arrive (offline): the same words as a line that did not open, and the quiet rejoin tries again
      joining.current = false;
      patch({ phase: "lost", error: ct("calls.failed") });
      return;
    }
    const { lk } = libs;
    const { RoomEvent } = lk;
    const room = newRoom(lk);
    for (const ev of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged,
    ]) {
      room.on(ev, redraw);
    }
    room.on(RoomEvent.Reconnecting, () => patch({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => patch({ reconnecting: false }));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => patch({ needsAudioTap: !room.canPlaybackAudio }));
    // somebody stepped out to another app on their phone, or came back
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== AWAY_TOPIC || !participant) return;
      const isAway = decodeAway(payload);
      if (isAway === null) return;
      setAway((s) => {
        const next = new Set(s);
        if (isAway) next.add(participant.identity);
        else next.delete(participant.identity);
        return next;
      });
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) =>
      setAway((s) => {
        if (!s.has(p.identity)) return s;
        const next = new Set(s);
        next.delete(p.identity);
        return next;
      }),
    );
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (roomRef.current !== room || unloading.current) return; // «اطلع», a newer call, or the page reloading (it comes back)
      roomRef.current = null;
      const code = reason as unknown as number | undefined;
      if (isDrop(code)) {
        patch({ phase: "lost", reconnecting: true });
        return;
      }
      remember(null);
      patch({ phase: code === 4 ? "removed" : code === 5 || code === 10 ? "ended" : "left", reconnecting: false });
    });
    try {
      let pass: Pass;
      try {
        pass = await passAsked;
      } catch (e) {
        // the server's refusal, already in Arabic (ended, not yours, no calls server)
        remember(null);
        const ended = e instanceof Error && e.message === callErrorText("calls.e.ended");
        patch({ phase: ended ? "ended" : "denied", error: e instanceof Error ? e.message : ct("calls.failed") });
        return;
      }
      // every microphone this call publishes (the first, or a new one after a change) is cleaned of noise
      if (pass.noiseFilter) {
        room.on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === lk.Track.Source.Microphone) void cleanMic(pub.track);
        });
      }
      try {
        await room.connect(pass.url, pass.token);
      } catch {
        // the calls server's own words are English: the person reads ours
        void room.disconnect();
        patch({ phase: "lost", error: ct("calls.failed") });
        return;
      }
      roomRef.current = room;
      rejoins.current = 0;
      remember({ id: callId, video, mic });
      patch({ phase: "in", reconnecting: false, needsAudioTap: !room.canPlaybackAudio });
      try {
        // a joiner of a topic's or a group's call comes in muted (and with no camera): they open them when they want to speak
        if (mic) {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (video) await room.localParticipant.setCameraEnabled(true);
        }
      } catch {
        // no permission, or no device: the person is in and hears everybody; the buttons ask again
        say(ct("calls.no_media"));
      }
      redraw();
    } finally {
      joining.current = false;
    }
  }, [passFor, patch, redraw, say, state.callId, state.phase]);

  // a drop is joined again quietly, with a growing pause, when the tab is visible and online
  React.useEffect(() => {
    if (state.phase !== "lost" || !state.callId) return;
    if (rejoins.current >= MAX_REJOINS) {
      patch({ reconnecting: false });
      return;
    }
    const callId = state.callId;
    const attempt = ++rejoins.current;
    const t = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        rejoins.current--; // wait for the person to come back; visibility below tries again
        return;
      }
      void join(callId, lastVideo.current, { mic: lastMic.current });
    }, rejoinDelayMs(attempt));
    return () => clearTimeout(t);
  }, [state.phase, state.callId, join, patch]);

  // a microphone the phone stopped or silenced is started again (a new capture, in the same place in the call). The
  // published microphone is never taken out on the way: if the phone still refuses, it stays «held», so the person
  // sees it and starts it with a tap — never a microphone quietly off.
  const reviveMic = React.useCallback(async (): Promise<boolean> => {
    const room = roomRef.current;
    if (!room) return true;
    if (micHeld(micFactsOf(room))) {
      const track = room.localParticipant.getTrackPublication(livekit().Track.Source.Microphone)?.track as LocalTrack | undefined;
      try {
        if (track) {
          await track.restartTrack();
          await track.resumeUpstream();
        }
      } catch {
        // the phone still refuses: the button asks again with a tap
      }
    }
    const held = micHeld(micFactsOf(room));
    patch({ micHeld: held });
    return !held;
  }, [patch]);

  // stepping out to another app and back: the others are told, and on the way back the camera and the microphone the
  // phone stopped are started again, the microphone with «رجع المايك» so the person knows they are heard again
  React.useEffect(() => {
    let later: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      const room = roomRef.current;
      if (!room || room.state !== "connected") return;
      const hidden = document.visibilityState === "hidden";
      void room.localParticipant.publishData(encodeAway(hidden), { reliable: true, topic: AWAY_TOPIC }).catch(() => undefined);
      clearTimeout(later);
      if (hidden) return;
      const camera = room.localParticipant.getTrackPublication(livekit().Track.Source.Camera)?.track;
      if (camera && !camera.isMuted && camera.mediaStreamTrack.readyState === "ended") void camera.restartTrack().catch(() => undefined);
      const wasHeld = micHeld(micFactsOf(room));
      // a moment for the phone to hand the microphone back by itself (the calls library tries too)
      later = setTimeout(() => {
        void reviveMic().then((ok) => {
          if (wasHeld && ok) toast?.toast(ct("calls.mic_back"), "success");
        });
      }, 700);
    };
    document.addEventListener("visibilitychange", changed);
    return () => {
      clearTimeout(later);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [reviveMic, toast]);

  // while the call is on screen, a microphone the phone holds (a phone call came in, the system took it) is shown
  React.useEffect(() => {
    if (state.phase !== "in") return;
    const look = setInterval(() => {
      const room = roomRef.current;
      if (!room || document.visibilityState !== "visible") return;
      const held = micHeld(micFactsOf(room));
      setState((s) => (s.micHeld === held ? s : { ...s, micHeld: held }));
    }, 2000);
    return () => clearInterval(look);
  }, [state.phase]);

  // back on the tab, or back online: a lost call is tried again at once
  React.useEffect(() => {
    const again = () => {
      if (state.phase === "lost" && state.callId && document.visibilityState === "visible") void join(state.callId, lastVideo.current, { mic: lastMic.current });
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [state.phase, state.callId, join]);

  // once allowed, this browser stays subscribed to rings (refreshed quietly on every visit; never asks here)
  React.useEffect(() => {
    void ensurePush(false);
  }, []);

  // after a reload (switching space reloads the page) the call is not lost: it is joined again by itself
  const joinRef = React.useRef(join);
  joinRef.current = join;
  React.useEffect(() => {
    const memo = remembered();
    if (!memo || roomRef.current) return;
    void callApi<CallView>(`/api/calls/${encodeURIComponent(memo.id)}`).then(
      (v) => {
        if (v.endedAt) remember(null);
        else void joinRef.current(memo.id, memo.video, { mic: memo.mic });
      },
      () => remember(null),
    );
  }, []);

  const leave = React.useCallback(async () => {
    const room = roomRef.current;
    const callId = state.callId;
    roomRef.current = null;
    remember(null);
    if (room) await room.disconnect().catch(() => undefined);
    if (callId) await fetch(`/api/calls/${encodeURIComponent(callId)}/leave`, { method: "POST" }).catch(() => undefined);
    patch({ phase: "left", reconnecting: false });
  }, [patch, state.callId]);

  const toggle = React.useCallback(async (what: "mic" | "cam" | "screen") => {
    const room = roomRef.current;
    if (!room) return;
    const me = room.localParticipant;
    // the microphone the phone holds: the tap starts it again (it was never the person's choice to mute it)
    if (what === "mic" && micHeld(micFactsOf(room))) {
      if (!(await reviveMic())) say(ct("calls.no_media"));
      redraw();
      return;
    }
    try {
      if (what === "mic") {
        const next = !me.isMicrophoneEnabled;
        await me.setMicrophoneEnabled(next);
        lastMic.current = next; // a quiet rejoin keeps what the person chose
      }
      else if (what === "cam") await me.setCameraEnabled(!me.isCameraEnabled);
      else await me.setScreenShareEnabled(!me.isScreenShareEnabled, { audio: true, contentHint: "detail" });
    } catch {
      if (what !== "screen") say(ct("calls.no_media"));
    }
    redraw();
  }, [redraw, reviveMic, say]);

  const startAudio = React.useCallback(async () => {
    await roomRef.current?.startAudio();
    patch({ needsAudioTap: false });
  }, [patch]);

  const prefetch = React.useCallback((callId: string) => {
    if (roomRef.current) return; // already in a call: «ردّ» will switch anyway
    // the library starts arriving at once, in step with the pass
    const loaded = loadCallLibs();
    loaded.catch(() => undefined);
    void callApi<Pass>(`/api/calls/${encodeURIComponent(callId)}/token`, {}).then(
      async (pass) => {
        prefetched.current = { callId, pass, at: Date.now() };
        try {
          await newRoom((await loaded).lk).prepareConnection(pass.url, pass.token);
        } catch {
          // no warm line: «ردّ» opens it the ordinary way
        }
      },
      () => undefined,
    );
  }, []);

  const pip = React.useCallback(() => {
    void pipRef.current?.requestPictureInPicture().catch(() => undefined);
  }, []);
  const canPip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  // the system's call controls (the phone's and the floating window's): microphone, camera, hang up, and the floating
  // window opened by the browser itself when the person steps out, where it does that for calls
  const actions = React.useRef({ toggle, leave, pip });
  actions.current = { toggle, leave, pip };
  const inCall = state.phase === "in";
  React.useEffect(() => {
    if (!inCall || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    setMediaAction("enterpictureinpicture", () => actions.current.pip());
    setMediaAction("togglemicrophone", () => void actions.current.toggle("mic"));
    setMediaAction("togglecamera", () => void actions.current.toggle("cam"));
    setMediaAction("hangup", () => void actions.current.leave());
    return () => {
      for (const action of MEDIA_ACTIONS) setMediaAction(action, null);
    };
  }, [inCall]);

  const room = roomRef.current;
  const me = room?.localParticipant;
  const micOn = !!me?.isMicrophoneEnabled && !state.micHeld;
  const camOn = !!me?.isCameraEnabled;
  React.useEffect(() => {
    if (!inCall || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession as MediaSession & { setMicrophoneActive?: (on: boolean) => void; setCameraActive?: (on: boolean) => void };
    try {
      session.setMicrophoneActive?.(micOn);
      session.setCameraActive?.(camOn);
    } catch {
      // older browsers: the controls just show no state
    }
  }, [inCall, micOn, camOn]);

  // a room exists only after the library was loaded, so `libs` is there whenever there is anything to draw from it
  const libs = callLibs;
  const everyone: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const api: CallApi = { state, room, everyone, away, reviveMic, canPip, pip, join, leave, toggle, startAudio, prefetch };
  const sounds = libs
    ? everyone
        .filter((p) => p !== room?.localParticipant)
        .flatMap((p) => [p.getTrackPublication(libs.lk.Track.Source.Microphone)?.track, p.getTrackPublication(libs.lk.Track.Source.ScreenShareAudio)?.track])
        .filter((t): t is LkTrack => !!t)
    : [];
  const showMini = miniVisible(pathname, state.callId) && (state.phase === "in" || state.phase === "connecting" || state.phase === "lost");

  return (
    <CallContext.Provider value={api}>
      {children}
      {libs &&
        sounds.map((t) => (
          <libs.media.AudioOut key={t.sid} track={t} />
        ))}
      {showMini && <MiniCall api={api} libs={libs} />}
      {libs && room && (state.phase === "in" || state.phase === "lost") && <PipFeed ref={pipRef} libs={libs} everyone={everyone} me={me} />}
    </CallContext.Provider>
  );
}

/** The call while the person is on another page: a small window in the corner. */
function MiniCall({ api, libs }: { api: CallApi; libs: CallLibs | null }) {
  const { state, room, everyone } = api;
  const me = room?.localParticipant;
  const main = libs && room ? libs.media.mainPicture(everyone, me) : null;
  const href = `/calls/${encodeURIComponent(state.callId ?? "")}`;
  const micOn = !!me?.isMicrophoneEnabled && !state.micHeld;

  return (
    <aside dir="rtl" lang="ar" aria-label={ct("calls.mini")} className="fixed bottom-20 end-3 z-[55] w-44 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-lg md:bottom-4">
      <Link href={href} className="relative block aspect-video bg-surface-2" aria-label={ct("calls.back_to_call")}>
        {main && room && libs ? (
          <libs.media.PersonPicture p={main.p} me={me} source={main.source} fit={main.source === libs.lk.Track.Source.ScreenShare ? "contain" : "cover"} small />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-fg-muted">{ct("calls.connecting")}</span>
        )}
        {state.reconnecting && <span className="absolute inset-x-0 top-0 bg-warn/80 px-1 text-center text-xs text-fg">{ct("calls.reconnecting_short")}</span>}
        {state.micHeld && !state.reconnecting && <span className="absolute inset-x-0 top-0 bg-warn/80 px-1 text-center text-xs text-fg">{ct("calls.mic_held")}</span>}
      </Link>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <button
          type="button"
          onClick={() => void api.toggle("mic")}
          aria-pressed={micOn}
          aria-label={state.micHeld ? ct("calls.mic_revive") : micOn ? ct("calls.mic_off") : ct("calls.mic_on")}
          title={state.micHeld ? ct("calls.mic_revive") : undefined}
          className={`h-9 w-9 rounded-full border text-base ${state.micHeld ? "border-warn bg-warn/15" : "border-border"}`}
        >
          <span aria-hidden="true">{state.micHeld ? "⚠️" : micOn ? "🎙️" : "🔇"}</span>
        </button>
        {api.canPip && main && (
          <button type="button" onClick={api.pip} aria-label={ct("calls.pip")} title={ct("calls.pip")} className="h-9 w-9 rounded-full border border-border text-base">
            <span aria-hidden="true">🪟</span>
          </button>
        )}
            <button type="button" onClick={() => void api.leave()} aria-label={ct("calls.leave")} title={ct("calls.leave")} className="h-9 w-9 rounded-full bg-danger text-base text-danger-fg">
          <span aria-hidden="true">📴</span>
        </button>
      </div>
    </aside>
  );
}

/** A theme colour for the drawn card (the canvas has no classes). */
function tokenColour(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
}

/**
 * The picture of the browser's floating window, kept off screen for the whole call: the main picture when somebody has
 * a camera or a shared screen, otherwise a small drawn card with who the call is with (a voice call has no picture, and
 * a floating window needs one). It is what the browser floats by itself when the person steps out, where it does that
 * (an iPhone: the video's own automatic picture-in-picture; Chrome: the media session's action), keeping the call in
 * front so the phone has less reason to take the microphone.
 */
const PipFeed = React.forwardRef<HTMLVideoElement, { libs: CallLibs; everyone: Participant[]; me: Participant | undefined }>(function PipFeed({ libs, everyone, me }, outer) {
  const inner = React.useRef<HTMLVideoElement | null>(null);
  const since = React.useRef(Date.now());
  const { mainPicture, nameOf } = libs.media;
  const main = mainPicture(everyone, me);
  const track = main ? main.p.getTrackPublication(main.source)?.track : undefined;
  const others = everyone.filter((p) => p !== me);
  const label = others.length === 1 && others[0] ? nameOf(others[0], me) : ct("calls.pip_card");

  React.useEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.setAttribute("autopictureinpicture", "");
    if (track) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
    // no picture: the card, drawn again every second (the floating window shows the last frame)
    const canvas = document.createElement("canvas");
    const pen = canvas.getContext("2d");
    if (!pen || typeof canvas.captureStream !== "function") return;
    canvas.width = 480;
    canvas.height = 270;
    const paper = tokenColour("--surface-1", "black");
    const ink = tokenColour("--fg", "white");
    const faint = tokenColour("--fg-muted", "gray");
    const draw = () => {
      const secs = Math.floor((Date.now() - since.current) / 1000);
      pen.fillStyle = paper;
      pen.fillRect(0, 0, canvas.width, canvas.height);
      pen.textAlign = "center";
      pen.direction = "rtl";
      pen.fillStyle = ink;
      pen.font = "bold 32px system-ui, sans-serif";
      pen.fillText(label, 240, 125, 440);
      pen.fillStyle = faint;
      pen.font = "24px system-ui, sans-serif";
      pen.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, 240, 172);
    };
    draw();
    const stream = canvas.captureStream(1);
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    const tick = setInterval(draw, 1000);
    return () => {
      clearInterval(tick);
      for (const t of stream.getTracks()) t.stop();
      if (el.srcObject === stream) el.srcObject = null;
    };
  }, [track, label]);

  return (
    <video
      ref={(el) => {
        inner.current = el;
        if (typeof outer === "function") outer(el);
        else if (outer) outer.current = el;
      }}
      autoPlay
      playsInline
      muted
      aria-hidden="true"
      className="pointer-events-none fixed bottom-0 start-0 h-px w-px opacity-0"
    />
  );
});
