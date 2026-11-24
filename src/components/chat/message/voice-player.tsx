"use client";
import React from "react";
import { Pause, Play } from "lucide-react";
import { AR } from "@/lib/i18n/dict";
import { ct } from "@/lib/chat/text";
import { nextVoiceSpeed, type VoiceSpeed } from "@/lib/chat/prefs";
import { voiceEngine, voiceSpeedLabel } from "@/lib/chat/voice-queue";
import { barsFor, formatDuration } from "@/lib/chat/waveform";

const BARS = 32;

interface View {
  active: boolean;
  playing: boolean;
  at: number;
  speed: VoiceSpeed;
}

/**
 * What ONE bubble reads of the shared engine. The object is kept while its fields do not change, so a bubble that is not the playing one is not drawn again
 * on every tick of the playing one.
 */
function useVoiceView(src: string): View {
  const last = React.useRef<View | null>(null);
  const read = React.useCallback((): View => {
    const s = voiceEngine.getSnapshot();
    const active = s.activeSrc === src;
    const next: View = { active, playing: active && s.playing, at: active ? s.at : 0, speed: s.speed };
    const prev = last.current;
    if (prev && prev.active === next.active && prev.playing === next.playing && prev.at === next.at && prev.speed === next.speed) return prev;
    last.current = next;
    return next;
  }, [src]);
  return React.useSyncExternalStore(voiceEngine.subscribe, read, read);
}

/**
 * The voice note in a bubble: play / pause, the stored waveform (`peaks`) drawn as bars that fill as it plays, and the time (the total until it starts, then
 * what is left). The sound plays through the shared engine (`voice-queue.ts`), which keeps ONE note
 * playing at a time, goes on to the next unheard note of the conversation when one ends, and keeps the sound going when the list drops this bubble. The
 * hidden `<audio>` here only reads the note's length.
 *
 * The speed chip («1×» → «1.5×» → «2×») shows while this note is the active one, and on every note once the person has picked a speed other than 1×; an
 * idle note at 1× looks exactly as it always did. The old screen and the quick chat use this player too, and get the same behaviour without a queue.
 */
export function VoicePlayer({ src, peaks = [], durationMs = 0, mine = false, speedAlways = false }: { src: string; peaks?: number[]; durationMs?: number; /** «الصوت زي تيليجرام»: the speed button is on every note (not only the one that plays) */ speedAlways?: boolean; /** the note sits in the person's OWN bubble, which is the accent colour: the player is drawn in the bubble's text colour so it shows */ mine?: boolean }) {
 const root = React.useRef<HTMLDivElement | null>(null);
 const view = useVoiceView(src);
 const [total, setTotal] = React.useState(durationMs);
 const bars = barsFor(peaks, BARS);
 React.useEffect(() => voiceEngine.attach(src), [src]);
 React.useEffect(() => {
  const box = root.current;
  if (!box || typeof IntersectionObserver === "undefined") return;
  const watch = new IntersectionObserver((entries) => {
   const last = entries[entries.length - 1];
   if (last) voiceEngine.setVisible(src, last.isIntersecting);
  });
  watch.observe(box);
  return () => watch.disconnect();
 }, [src]);
 const { active, playing, at, speed } = view;
 const left = playing || at > 0 ? total * (1 - at) : total;
 const label = AR["chat.f.voice_label"] ?? "";
 // in my own bubble (the accent colour) accent-on-accent would vanish: the button, the bars and the time take the bubble's own text colour
 const tone = mine
  ? { button: "bg-bubble-out-fg text-bubble-out hover:bg-bubble-out-fg/90 focus-visible:outline-bubble-out-fg", played: "bg-bubble-out-fg", rest: "bg-bubble-out-fg/45", time: "text-bubble-out-fg/80", chip: "bg-bubble-out-fg/20 text-bubble-out-fg hover:bg-bubble-out-fg/30" }
  : { button: "bg-accent text-accent-fg hover:bg-accent/90 focus-visible:outline-accent", played: "bg-accent", rest: "bg-accent/45", time: "text-fg-muted", chip: "bg-accent/15 text-accent hover:bg-accent/25" };
 return (
  <div ref={root} data-voice className="mt-1 flex min-w-48 items-center gap-2" role="group" aria-label={`${label} ${formatDuration(total)}`}>
   <button
    type="button"
    onClick={() => voiceEngine.toggle(src)}
    aria-label={playing ? AR["chat.f.pause"] : AR["chat.f.play"]}
    className={`flex size-[42px] shrink-0 items-center justify-center rounded-full shadow-card transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${tone.button}`}
   >
    {playing ? <Pause aria-hidden="true" className="size-5 fill-current" /> : <Play aria-hidden="true" className="size-5 fill-current" />}
   </button>
   <div aria-hidden="true" className="flex h-8 flex-1 items-center gap-[2px]" dir="ltr">
    {bars.map((p, i) => (
     <span
      key={i}
      className={`w-[3px] rounded-full ${i / BARS < at ? tone.played : tone.rest}`}
      style={{ height: `${Math.max(12, p)}%` }}
     />
    ))}
   </div>
   <span className={`w-11 shrink-0 text-xs tabular-nums ${tone.time}`} dir="ltr">{formatDuration(left)}</span>
   {speedAlways || active || speed !== 1 ? (
    <button
     type="button"
     data-voice-speed={speed}
     onClick={() => voiceEngine.setSpeed(nextVoiceSpeed(speed))}
     aria-label={ct("chatvoice.speed", { speed: voiceSpeedLabel(speed) })}
     className={`inline-flex min-h-7 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${tone.chip}`}
     dir="ltr"
    >
     {voiceSpeedLabel(speed)}
    </button>
   ) : null}
   <audio
    src={src}
    preload="metadata"
    className="hidden"
    onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(Math.round(d * 1000)); }}
   />
  </div>
 );
}
