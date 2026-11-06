"""
The voice agent of «المساعد بالاجتماعات»: a small program on the owner's own server that joins a call's room as «المساعد», listens, and speaks.

    room audio --(voice activity)--> sentence --(faster-whisper)--> text --(POST /api/voice-agent/turn)--> answer --(Piper)--> room audio

Free software only: faster-whisper and Piper run here, on the CPU. The workspace decides WHAT to say (it asks the owner's own model, with the
words filtered first); this program only hears and speaks. Nothing is recorded: audio lives in memory for the length of one sentence.
"""
import asyncio
import json
import logging
import os
import time

import aiohttp
import numpy as np
import webrtcvad
from aiohttp import web
from faster_whisper import WhisperModel
from livekit import rtc
from piper import PiperVoice

import logic
import tashkeel
import tts_edge
import tts_gemini

log = logging.getLogger("voice-agent")

SECRET = os.environ.get("VOICE_AGENT_SECRET", "")
TURN_URL = os.environ.get("WORKSPACE_TURN_URL", "")  # https://workspace.zakiai.io/api/voice-agent/turn
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
PIPER_VOICE = os.environ.get("PIPER_VOICE", "/models/ar_JO-kareem-medium.onnx")
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "2"))
# Vowel marks before speaking (the voice was trained on marked text; without them it sounds like a robot). TASHKEEL=0 turns it off.
TASHKEEL = os.environ.get("TASHKEEL", "1") != "0"
TASHKEEL_DIR = os.environ.get("TASHKEEL_DIR", "/models/tashkeel")


# Which voice speaks: "edge" (Microsoft's neural voices, free, Standard Arabic; the default), "gemini" (needs the owner's own key), or "piper"
# (local only, nothing leaves the server). A failure of the chosen one falls back to Piper.
TTS_ENGINE = os.environ.get("TTS_ENGINE", "edge").strip().lower()
EDGE_VOICE = os.environ.get("EDGE_VOICE", "ar-SA-HamedNeural")
EDGE_RATE = os.environ.get("EDGE_RATE", "+0%")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
GEMINI_FALLBACK_MODEL = os.environ.get("GEMINI_TTS_FALLBACK_MODEL", "gemini-2.5-flash-preview-tts")
GEMINI_VOICE = os.environ.get("GEMINI_VOICE", "Kore")


def _knob(name: str):
    """An optional Piper setting from the environment; unset means the voice's own default."""
    raw = os.environ.get(name, "").strip()
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


PIPER_LENGTH_SCALE = _knob("PIPER_LENGTH_SCALE")  # above 1 = slower
PIPER_NOISE_SCALE = _knob("PIPER_NOISE_SCALE")  # more variation in the voice
PIPER_NOISE_W = _knob("PIPER_NOISE_W")  # more variation in the rhythm
PIPER_SENTENCE_SILENCE = _knob("PIPER_SENTENCE_SILENCE") or 0.2  # seconds of pause between sentences

RATE = 16000  # what the recogniser and the voice detector want
FRAME_MS = 30
FRAME_SAMPLES = RATE * FRAME_MS // 1000
END_SILENCE_FRAMES = 700 // FRAME_MS  # 0.7 s of quiet ends a sentence
MAX_UTTERANCE_SECONDS = 15
MIN_UTTERANCE_SECONDS = 0.6
OUT_RATE = 24000  # the room's voice track

_whisper = None
_voice = None
_tashkeel = None


def load_models() -> None:
    global _whisper, _voice, _tashkeel
    _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    _voice = PiperVoice.load(PIPER_VOICE)
    if TASHKEEL:
        _tashkeel = tashkeel.load(TASHKEEL_DIR)
        if _tashkeel:
            sample = "برأيي لازم نأجل الاجتماع لبكرا"
            log.info("tashkeel on: %s -> %s", sample, _tashkeel(sample))
    else:
        log.info("tashkeel off (TASHKEEL=0)")


def transcribe(pcm: np.ndarray) -> str:
    segments, _ = _whisper.transcribe(
        pcm.astype(np.float32) / 32768.0, language="ar", beam_size=1, vad_filter=False, condition_on_previous_text=False
    )
    return " ".join(s.text.strip() for s in segments).strip()


def synthesize(text: str):
    """Piper's answer as 16-bit mono PCM and its sample rate."""
    if _tashkeel:
        text = _tashkeel(text)
    chunks = _voice.synthesize_stream_raw(
        text,
        length_scale=PIPER_LENGTH_SCALE,
        noise_scale=PIPER_NOISE_SCALE,
        noise_w=PIPER_NOISE_W,
        sentence_silence=PIPER_SENTENCE_SILENCE,
    )
    return b"".join(chunks), _voice.config.sample_rate


class Meeting:
    def __init__(self, call_id, room_name, url, token, title):
        self.call_id, self.room_name, self.url, self.token, self.title = call_id, room_name, url, token, title
        self.room = rtc.Room()
        self.source = None
        self.tasks = set()
        self.history = []
        self.last_spoke_at = None
        self.speaking = False
        self.busy = asyncio.Lock()
        self.closed = asyncio.Event()

    async def start(self) -> None:
        @self.room.on("track_subscribed")
        def on_track(track, _publication, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity != "assistant":
                self._spawn(self.listen(track, participant.name or "مشارك"))

        @self.room.on("disconnected")
        def on_disconnected(*_):
            self.closed.set()

        await self.room.connect(self.url, self.token)
        self.source = rtc.AudioSource(OUT_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("assistant-voice", self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self._spawn(self.watch_empty())
        log.info("joined %s", self.room_name)

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def watch_empty(self) -> None:
        """A room with nobody left in it ends the session (20 seconds of grace for a reconnect)."""
        while not self.closed.is_set():
            await asyncio.sleep(10)
            if not self.room.remote_participants:
                await asyncio.sleep(20)
                if not self.room.remote_participants:
                    await self.stop()
                    return

    async def stop(self) -> None:
        self.closed.set()
        for task in list(self.tasks):
            if task is not asyncio.current_task():
                task.cancel()
        await self.room.disconnect()
        log.info("left %s", self.room_name)

    async def listen(self, track, speaker: str) -> None:
        """One person's microphone: cut it into sentences by voice activity, and hand each sentence on."""
        vad = webrtcvad.Vad(2)
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        buf = np.zeros(0, dtype=np.int16)
        frames = []
        quiet = 0
        async for event in stream:
            buf = np.concatenate([buf, np.frombuffer(event.frame.data, dtype=np.int16)])
            while len(buf) >= FRAME_SAMPLES:
                frame, buf = buf[:FRAME_SAMPLES], buf[FRAME_SAMPLES:]
                if vad.is_speech(frame.tobytes(), RATE):
                    frames.append(frame)
                    quiet = 0
                elif frames:
                    frames.append(frame)
                    quiet += 1
                too_long = len(frames) * FRAME_MS / 1000 >= MAX_UTTERANCE_SECONDS
                if frames and (quiet >= END_SILENCE_FRAMES or too_long):
                    pcm = np.concatenate(frames)
                    frames, quiet = [], 0
                    if len(pcm) / RATE >= MIN_UTTERANCE_SECONDS:
                        self._spawn(self.heard(pcm, speaker))

    async def heard(self, pcm, speaker: str) -> None:
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, transcribe, pcm)
        if logic.is_noise(text):
            return
        addressed = logic.is_addressed(text, self.last_spoke_at, time.time())
        self.history.append({"role": "user", "text": f"{speaker}: {text}"})
        self.history = self.history[-12:]
        if not addressed or self.speaking:
            return
        async with self.busy:
            answer = await self.ask(speaker, text, addressed)
            if answer:
                self.history.append({"role": "assistant", "text": answer})
                await self.say(answer)

    async def ask(self, speaker: str, text: str, addressed: bool) -> str:
        body = json.dumps(
            {"callId": self.call_id, "speaker": speaker, "text": text, "addressed": addressed, "history": self.history[:-1][-10:]},
            ensure_ascii=False,
        )
        ts = int(time.time())
        headers = {"content-type": "application/json", "x-agent-timestamp": str(ts), "x-agent-signature": logic.sign(SECRET, ts, body)}
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(TURN_URL, data=body.encode(), headers=headers, timeout=aiohttp.ClientTimeout(total=40)) as res:
                    if res.status != 200:
                        log.warning("turn refused: %s", res.status)
                        return ""
                    return (await res.json()).get("reply", "")
        except Exception as err:  # the meeting goes on without an answer
            log.warning("turn failed: %s", err)
            return ""

    async def say(self, text: str) -> None:
        loop = asyncio.get_running_loop()
        heard = None
        if TTS_ENGINE == "gemini" and GEMINI_KEY:  # a natural voice; any failure falls through to the local one
            async with aiohttp.ClientSession() as http:
                heard = await tts_gemini.synthesize(http, GEMINI_KEY, text, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_VOICE)
        elif TTS_ENGINE == "edge":
            heard = await tts_edge.synthesize(text, EDGE_VOICE, EDGE_RATE)
        if heard is None and TTS_ENGINE != "piper":
            log.warning("speaking with the local voice instead")
        raw, rate = heard if heard else await loop.run_in_executor(None, synthesize, text)
        pcm = np.frombuffer(raw, dtype=np.int16)
        if rate != OUT_RATE:  # a plain linear resample is enough for speech
            x = np.linspace(0, len(pcm) - 1, int(len(pcm) * OUT_RATE / rate))
            pcm = np.interp(x, np.arange(len(pcm)), pcm).astype(np.int16)
        self.speaking = True
        try:
            step = OUT_RATE // 100  # 10 ms
            for i in range(0, len(pcm), step):
                chunk = pcm[i : i + step]
                if len(chunk) < step:
                    chunk = np.pad(chunk, (0, step - len(chunk)))
                await self.source.capture_frame(rtc.AudioFrame(chunk.tobytes(), OUT_RATE, 1, step))
            await self.source.wait_for_playout()
        finally:
            self.speaking = False
            self.last_spoke_at = time.time()


meetings = {}


async def authed(request: web.Request) -> bytes:
    raw = await request.read()
    ok = SECRET and logic.verify(SECRET, request.headers.get("x-agent-timestamp"), request.headers.get("x-agent-signature"), raw.decode("utf8", "replace"))
    if not ok:
        raise web.HTTPNotFound()
    return raw


async def join(request: web.Request) -> web.Response:
    data = json.loads(await authed(request))
    call_id = str(data["callId"])
    if call_id in meetings:
        return web.json_response({"ok": True})
    if len(meetings) >= MAX_SESSIONS:  # speech to text on a CPU: two meetings at once is plenty
        return web.json_response({"error": "busy"}, status=429)
    meeting = Meeting(call_id, data["room"], data["url"], data["token"], data.get("title"))
    meetings[call_id] = meeting
    try:
        await meeting.start()
    except Exception:
        meetings.pop(call_id, None)
        log.exception("join failed")
        return web.json_response({"error": "join_failed"}, status=502)

    async def cleanup():
        await meeting.closed.wait()
        meetings.pop(call_id, None)

    asyncio.create_task(cleanup())
    return web.json_response({"ok": True})


async def leave(request: web.Request) -> web.Response:
    data = json.loads(await authed(request))
    meeting = meetings.pop(str(data["callId"]), None)
    if meeting:
        await meeting.stop()
    return web.json_response({"ok": True})


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "meetings": len(meetings)})


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if len(SECRET) < 16 or not TURN_URL:
        raise SystemExit("VOICE_AGENT_SECRET (16+ characters) and WORKSPACE_TURN_URL are required")
    log.info("loading models (the first start downloads the speech model, a few minutes)")
    load_models()
    if TTS_ENGINE == "gemini" and not GEMINI_KEY:
        log.warning("TTS_ENGINE=gemini but GEMINI_API_KEY is empty: the local voice will speak")
    log.info(
        "voice: %s",
        {"edge": f"microsoft {EDGE_VOICE}, local Piper as backup", "gemini": f"gemini {GEMINI_MODEL} / {GEMINI_VOICE}, local Piper as backup"}.get(
            TTS_ENGINE, "local Piper only"
        ),
    )
    log.info("models ready, listening on port %s", os.environ.get("PORT", "8080"))
    app = web.Application()
    app.add_routes([web.post("/join", join), web.post("/leave", leave), web.get("/health", health)])
    web.run_app(app, port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
