"""
The voice agent of «المساعد بالاجتماعات»: a small program on the owner's own server that joins a call's room as «المساعد», listens, and speaks.

    room audio --(voice activity)--> sentence --(faster-whisper)--> text --(POST /api/voice-agent/turn)--> answer --(Piper)--> room audio

Free software only: faster-whisper and Piper run here. The workspace decides WHAT to say (it asks the owner's own model, with the
words filtered first); this program only hears and speaks. NO AUDIO IS EVER STORED: sound lives in memory for the length of one sentence.

Only while the OWNER has turned on «تسجيل نص الاجتماعات» for this call (the workspace tells it: the join says `transcript`, and /transcript flips it) every finished
sentence is also handed over as TEXT, with who said it, to a second signed door (POST /api/voice-agent/transcript: {callId, personId, text}). The minutes are
written by the workspace AFTER the call.

WHERE it listens (stt_device.py): on the graphics card when there is one that really works (a bigger, more accurate model, much faster), else on the
processor as before. The card never stops the agent from starting; /health says which one listens, with which model, and why.

The same recogniser also writes the words of a VOICE NOTE for the site, through the signed door POST /transcribe-note (notes.py), one piece at a time
so a meeting is never held for the length of a note.
"""
import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

import aiohttp
import numpy as np
import webrtcvad
from aiohttp import web
from faster_whisper import WhisperModel
from livekit import rtc
from piper import PiperVoice

import logic
import notes
import stt_device
import tashkeel
import stt_groq
import tts_edge
import tts_gemini

log = logging.getLogger("voice-agent")

SECRET = os.environ.get("VOICE_AGENT_SECRET", "")
TURN_URL = os.environ.get("WORKSPACE_TURN_URL", "")  # https://workspace.zakiai.io/api/voice-agent/turn
# The door of the written lines (S6.2), beside the turn door and signed the same way. Derived from the turn address unless set.
TRANSCRIPT_URL = os.environ.get("WORKSPACE_TRANSCRIPT_URL", "").strip() or (TURN_URL.rsplit("/", 1)[0] + "/transcript" if TURN_URL else "")
# When the door says «not stored» (the record is off for that call) the agent stops sending for this long.
TRANSCRIPT_PAUSE_SECONDS = 60
TRANSCRIPT_LINE_MAX = 1500
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")  # the model on the PROCESSOR
# The card. WHISPER_MODEL is deliberately not reused there: Coolify keeps the «small» it read from the compose file, and the card would never get more.
STT_DEVICE = os.environ.get("STT_DEVICE", "auto")  # auto | cpu | cuda
WHISPER_GPU_MODEL = os.environ.get("WHISPER_GPU_MODEL", "").strip() or stt_device.GPU_DEFAULT_MODEL
WHISPER_GPU_COMPUTE = os.environ.get("WHISPER_GPU_COMPUTE", "").strip() or stt_device.GPU_DEFAULT_COMPUTE
# how long one try of a model on the card may take; the first one includes downloading the model (about 3 GB for large-v3)
WHISPER_GPU_TRY_SECONDS = float(os.environ.get("WHISPER_GPU_TRY_SECONDS", "").strip() or 1800)
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

# Timings are always logged; what was said is logged only with VOICE_DEBUG=1 (it is the people's talk).
DEBUG = os.environ.get("VOICE_DEBUG", "0") == "1"
# A short «one moment» is spoken the moment the assistant is addressed, while the model thinks. VOICE_FILLER=0 turns it off.
FILLER = os.environ.get("VOICE_FILLER", "0") == "1"  # off by default: it only repeats itself while the real answer is late
FILLER_TEXT = os.environ.get("VOICE_FILLER_TEXT", "حسنًا، لحظة من فضلك.")
# How many CPU threads the LOCAL speech recogniser may use. The server is shared with the site and the calls: more threads than cores only thrash.
WHISPER_THREADS = int(os.environ.get("WHISPER_THREADS", "0")) or min(os.cpu_count() or 4, 4)
# Who listens: "local" (faster-whisper on this server; nothing leaves it) or "groq" (Groq's hosted Whisper with the owner's own GROQ_API_KEY: fast
# and far better Arabic, but every sentence of the room is sent to Groq). Any failure of the hosted one falls back to the local one.
STT_ENGINE = os.environ.get("STT_ENGINE", "local").strip().lower()
GROQ_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_STT_MODEL = os.environ.get("GROQ_STT_MODEL", "whisper-large-v3")  # the full model: better Arabic than -turbo, still well under a second
# A hint for the recogniser so it knows the assistant's names (it wrote «يا مساعد» as «يا موساق»). Set STT_PROMPT to a space to send none.
STT_PROMPT = os.environ.get("STT_PROMPT", "اجتماع عمل. المساعد زاكي يشارك فيه.").strip()

RATE = 16000  # what the recogniser and the voice detector want
FRAME_MS = 30
FRAME_SAMPLES = RATE * FRAME_MS // 1000
END_SILENCE_FRAMES = 500 // FRAME_MS  # half a second of quiet ends a sentence
MAX_UTTERANCE_SECONDS = 15
MIN_UTTERANCE_SECONDS = 0.6
OUT_RATE = 24000  # the room's voice track

_stt = None  # stt_device.Choice: the recogniser, and where and why it runs there
_ready = False  # every model is loaded; until then /join and /transcribe-note answer «loading»
_voice = None
_tashkeel = None
_filler = None


def _cards() -> int:
    import ctranslate2

    return ctranslate2.get_cuda_device_count()


def _load_cpu(model: str):
    return WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=WHISPER_THREADS)


def load_recogniser():
    setting, understood = stt_device.parse_setting(STT_DEVICE)
    if not understood:
        log.warning("STT_DEVICE=%s is not auto, cpu or cuda: using auto", STT_DEVICE[:20])
    choice = stt_device.choose(
        setting,
        cpu_model=WHISPER_MODEL,
        gpu_model=WHISPER_GPU_MODEL,
        gpu_compute=WHISPER_GPU_COMPUTE,
        gpu_count=_cards,
        gpu_card=stt_device.gpu_card,
        libs_ok=stt_device.cublas_present,
        probe=lambda model, compute: stt_device.run_probe(model, compute, timeout=WHISPER_GPU_TRY_SECONDS),
        load_gpu=lambda model, compute: WhisperModel(model, device="cuda", compute_type=compute),
        load_cpu=_load_cpu,
        warn=log.warning,
    )
    if choice.device == "cuda":
        card = f"{choice.gpu['name']}, {choice.gpu['memoryMb']} MB" if choice.gpu else "name unknown"
        log.info("speech recogniser: %s (%s) on the GRAPHICS CARD (%s), one sentence at a time", choice.model, choice.compute, card)
    else:
        log.info("speech recogniser: %s on %d threads of the processor (one sentence at a time)%s", choice.model, WHISPER_THREADS, f", reason: {choice.reason}" if choice.reason else "")
    return choice


def load_models() -> None:
    global _stt, _voice, _tashkeel, _ready
    _stt = load_recogniser()
    if STT_ENGINE == "groq":
        log.info("listening: groq %s%s", GROQ_STT_MODEL, "" if GROQ_KEY else " (NO KEY: local only)")
    else:
        log.info("listening: local only (nothing leaves the server)")
    _voice = PiperVoice.load(PIPER_VOICE)
    if TASHKEEL:
        _tashkeel = tashkeel.load(TASHKEEL_DIR)
        if _tashkeel:
            sample = "برأيي لازم نأجل الاجتماع لبكرا"
            log.info("tashkeel on: %s -> %s", sample, _tashkeel(sample))
    else:
        log.info("tashkeel off (TASHKEEL=0)")
    _ready = True


def transcribe(pcm: np.ndarray) -> str:
    segments, _ = _stt.recogniser.transcribe(
        pcm.astype(np.float32) / 32768.0,
        language="ar",
        beam_size=1,
        vad_filter=False,
        condition_on_previous_text=False,
        initial_prompt=STT_PROMPT or None,
    )
    return " ".join(s.text.strip() for s in segments).strip()


# ONE sentence at a time on the local recogniser: several at once (every voice, every pause) fought over the same cores and a two-second
# sentence took up to 29 seconds. The pieces of a voice note wait in the same line.
_local_stt = ThreadPoolExecutor(max_workers=1, thread_name_prefix="whisper")
_gpu_guard = stt_device.RuntimeGuard()


def on_recogniser(fn):
    """fn on the recogniser's one worker, in turn."""
    return asyncio.get_running_loop().run_in_executor(_local_stt, fn)


def _move_to_cpu() -> None:
    global _stt
    card = _stt
    _stt = stt_device.Choice("cpu", WHISPER_MODEL, "int8", card.setting, card.requested, card.gpu_found, card.gpu, "gpu_runtime", _load_cpu(WHISPER_MODEL))
    log.warning("the graphics card stopped working: listening on the processor (%s) until the next restart", WHISPER_MODEL)


async def recogniser_failed(err: Exception) -> None:
    # the error of the library only (a CUDA or memory message): never anything that was said
    log.warning("local recogniser failed: %s: %s", type(err).__name__, str(err)[:200])
    if _stt and _stt.device == "cuda" and _gpu_guard.failed():
        try:
            await on_recogniser(_move_to_cpu)
        except Exception as again:
            log.warning("could not load the processor's model: %s", type(again).__name__)


async def recognise(pcm: np.ndarray) -> str:
    """The sentence as text: the hosted recogniser when chosen, the local one otherwise or when the hosted one fails."""
    if STT_ENGINE == "groq" and GROQ_KEY:
        async with aiohttp.ClientSession() as http:
            text = await stt_groq.transcribe(http, GROQ_KEY, pcm.tobytes(), GROQ_STT_MODEL, STT_PROMPT)
        if text is not None:
            return text
        log.warning("listening with the local recogniser instead")
    try:
        text = await on_recogniser(lambda: transcribe(pcm))
    except Exception as err:  # this sentence is lost; the meeting goes on
        await recogniser_failed(err)
        return ""
    _gpu_guard.worked()
    return text


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
    def __init__(self, call_id, room_name, url, token, title, transcript=False):
        self.call_id, self.room_name, self.url, self.token, self.title = call_id, room_name, url, token, title
        # the owner turned the TEXT record on for this call: finished sentences go to the signed transcript door (text only, never sound)
        self.transcript = bool(transcript)
        self.transcript_pause_until = 0.0
        self.room = rtc.Room()
        self.source = None
        self.tasks = set()
        self.history = []
        # who the assistant answered last and when it finished speaking: only that person's next SHORT sentence is a follow-up (logic.FOLLOW_UP_SECONDS)
        self.follow = logic.FollowUp()
        self.speaking = False
        self.busy = asyncio.Lock()
        self.closed = asyncio.Event()

    async def start(self) -> None:
        @self.room.on("track_subscribed")
        def on_track(track, _publication, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity != "assistant":
                self._spawn(self.listen(track, participant.name or "مشارك", participant.identity))

        @self.room.on("disconnected")
        def on_disconnected(*_):
            self.closed.set()

        await self.room.connect(self.url, self.token)
        self.source = rtc.AudioSource(OUT_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("assistant-voice", self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        self._spawn(self.watch_empty())
        if FILLER:
            self._spawn(self.filler())  # rendered now, so the first «one moment» is ready when it is needed
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

    async def listen(self, track, speaker: str, speaker_id: str) -> None:
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
                        self._spawn(self.heard(pcm, speaker, speaker_id))

    async def heard(self, pcm, speaker: str, speaker_id: str) -> None:
        began = time.time()  # the speaker has just finished: everything from here is the wait they feel
        text = await recognise(pcm)
        stt_ms = int((time.time() - began) * 1000)
        if logic.is_noise(text, STT_PROMPT):
            log.info("heard noise (%.1fs of audio, listened %d ms)", len(pcm) / RATE, stt_ms)
            return
        if self.transcript and TRANSCRIPT_URL and time.time() >= self.transcript_pause_until:
            self._spawn(self.record(speaker_id, text))  # a text line for the minutes; it never delays the answer
        # the follow-up window is measured to the moment the person STOPPED talking (`began`), not to the end of the slow recognition
        addressed = logic.is_addressed(text, self.follow.at, began, same_speaker=self.follow.is_follow_up(speaker_id, began))
        log.info("heard %.1fs of audio, listened %d ms, addressed=%s%s", len(pcm) / RATE, stt_ms, addressed, f", text: {text}" if DEBUG else "")
        self.history.append({"role": "user", "text": f"{speaker}: {text}"})
        self.history = self.history[-12:]
        if not addressed or self.speaking:
            return
        async with self.busy:
            asked = time.time()
            thinking = asyncio.create_task(self.ask(speaker, text, addressed))
            if FILLER and not self.speaking:  # a short «one moment» while the model thinks, so the room is not silent
                try:
                    await self.play(await self.filler())
                except Exception as err:  # never let the filler cost the answer
                    log.warning("filler failed: %s", err)
            answer = await thinking
            think_ms = int((time.time() - asked) * 1000)
            if answer:
                self.history.append({"role": "assistant", "text": answer})
                spoke = time.time()
                await self.say(answer)
                self.follow.answered(speaker_id, time.time())  # the follow-up window of this person starts when the answer ends
                log.info(
                    "answered: listened %d ms + thought %d ms + voice %d ms to the end of the answer, %d ms after they stopped%s",
                    stt_ms, think_ms, int((time.time() - spoke) * 1000), int((time.time() - began) * 1000), f", said: {answer}" if DEBUG else "",
                )
            else:
                log.info("no answer (listened %d ms, waited %d ms)", stt_ms, think_ms)

    async def record(self, speaker_id: str, text: str) -> None:
        """One finished sentence as TEXT for the minutes: who said it and what. Signed like the turn request. Failure only costs that line."""
        body = json.dumps({"callId": self.call_id, "personId": speaker_id, "text": text[:TRANSCRIPT_LINE_MAX]}, ensure_ascii=False)
        ts = int(time.time())
        headers = {"content-type": "application/json", "x-agent-timestamp": str(ts), "x-agent-signature": logic.sign(SECRET, ts, body)}
        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(TRANSCRIPT_URL, data=body.encode(), headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as res:
                    if res.status != 200:
                        log.warning("transcript refused: %s", res.status)
                        self.transcript_pause_until = time.time() + TRANSCRIPT_PAUSE_SECONDS
                        return
                    answer = await res.json()
                    if not answer.get("stored"):  # the record is not on for this call: stop sending for a while
                        self.transcript_pause_until = time.time() + TRANSCRIPT_PAUSE_SECONDS
        except Exception as err:  # the meeting goes on; this line is lost
            log.warning("transcript failed: %s", err)

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
                    answer = await res.json()
                    # «[صمت]» or nothing: the assistant stays quiet, even when it was named (it never invents a sentence instead)
                    return answer.get("reply", "") if logic.should_speak(answer) else ""
        except Exception as err:  # the meeting goes on without an answer
            log.warning("turn failed: %s", err)
            return ""

    async def filler(self):
        """«One moment»: spoken once, then kept (rendering it needs the voice engine, the first time only)."""
        global _filler
        if _filler is None:
            _filler = await self.render(FILLER_TEXT)
        return _filler

    async def say(self, text: str) -> None:
        await self.play(await self.render(text))

    async def render(self, text: str):
        """The text as 24 kHz 16-bit mono sound."""
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
        return pcm

    async def play(self, pcm) -> None:
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
    if not _ready:
        return web.json_response({"error": "loading"}, status=503)
    if len(meetings) >= MAX_SESSIONS:  # speech to text on a CPU: two meetings at once is plenty
        return web.json_response({"error": "busy"}, status=429)
    meeting = Meeting(call_id, data["room"], data["url"], data["token"], data.get("title"), data.get("transcript", False))
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


async def set_transcript(request: web.Request) -> web.Response:
    """The owner turned the text record of this call on or off (signed like join and leave): start or stop sending the written lines."""
    data = json.loads(await authed(request))
    meeting = meetings.get(str(data["callId"]))
    if meeting:
        meeting.transcript = bool(data.get("on", False))
        meeting.transcript_pause_until = 0.0
    return web.json_response({"ok": True})


async def leave(request: web.Request) -> web.Response:
    data = json.loads(await authed(request))
    meeting = meetings.pop(str(data["callId"]), None)
    if meeting:
        await meeting.stop()
    return web.json_response({"ok": True})


async def decode(demuxer: str, audio: bytes):
    """The recording as 16 kHz mono 16-bit sound, or None. It goes through ffmpeg without ever reaching a disk: an in-memory file where the system has
    one (an mp4 whose index is at its end can only be read from something seekable), else the input pipe."""
    memory = None
    try:
        memory = os.memfd_create("voice-note")
        view = memoryview(audio)
        while view:
            view = view[os.write(memory, view) :]
    except (AttributeError, OSError):
        if memory is not None:
            os.close(memory)
        memory = None
    piped = memory is None
    try:
        process = await asyncio.create_subprocess_exec(
            *notes.ffmpeg_args(demuxer, "pipe:0" if piped else f"/proc/self/fd/{memory}"),
            stdin=asyncio.subprocess.PIPE if piped else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,  # ffmpeg quotes what is inside a file: none of it reaches a log
            **({} if piped else {"pass_fds": (memory,)}),
        )
        try:
            pcm, _ = await asyncio.wait_for(process.communicate(audio if piped else None), notes.DECODE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return None
        return pcm if process.returncode == 0 and len(pcm) >= 2 else None
    finally:
        if memory is not None:
            os.close(memory)


note_gate = notes.NoteGate()


def _refused(code: str, status: int) -> web.Response:
    return web.json_response({"error": code}, status=status)


async def transcribe_note(request: web.Request) -> web.Response:
    """The words of one voice note for the site (signed; notes.py). Always the recogniser of THIS server, whatever STT_ENGINE says about meetings.
    Nothing is stored; the log gets sizes and times only."""
    signed = notes.check_headers(SECRET, request.headers)  # before a byte of the body is read
    if signed is None:
        raise web.HTTPNotFound()
    if not _ready:
        return _refused("loading", 503)
    if (request.content_length or 0) > notes.MAX_NOTE_BYTES:
        return _refused("too_large", 413)
    sha, language = signed
    began = time.monotonic()
    try:
        async with note_gate.turn():
            audio = await notes.read_limited(request.content.iter_chunked(65536))
            if audio is None:
                return _refused("too_large", 413)
            if not notes.body_matches(audio, sha):
                raise web.HTTPNotFound()
            demuxer = notes.container_of(audio[:64])
            pcm = await decode(demuxer, audio) if demuxer else None
            if pcm is None:
                return _refused("unreadable", 415)
            seconds = notes.pcm_seconds(len(pcm))
            if seconds > notes.MAX_NOTE_SECONDS:
                return _refused("too_long", 422)
            samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
            try:
                text = await notes.drain(
                    lambda: (s.text for s in _stt.recogniser.transcribe(samples, **notes.note_options(_stt.device, language))[0]),
                    on_recogniser,
                    deadline=began + notes.NOTE_DEADLINE_SECONDS,
                )
            except notes.TooSlow:
                log.warning("voice note: %.0f seconds of sound were too slow to write", seconds)
                return _refused("too_slow", 504)
            except Exception as err:
                await recogniser_failed(err)
                return _refused("failed", 500)
            _gpu_guard.worked()
            log.info("voice note written: %.0f seconds of sound in %d ms on %s", seconds, int((time.monotonic() - began) * 1000), _stt.device)
            return web.json_response({"text": notes.clean_note(text)}, headers={"cache-control": "no-store"})
    except notes.Busy:
        return _refused("busy", 429)


async def health(request: web.Request) -> web.Response:
    """No secret in it. A signed look (the site's) also learns whether the two secrets match."""
    body = {"ok": True, "meetings": len(meetings), "stt": stt_device.health_stt(_stt if _ready else None, hosted_meetings=STT_ENGINE == "groq" and bool(GROQ_KEY))}
    matches = notes.secret_matches(SECRET, request.headers)
    if matches is not None:
        body["secretOk"] = matches
    return web.json_response(body)


async def load_in_the_background(app: web.Application) -> None:
    """The port opens at once and /health says «loading»: the first start on a graphics card downloads gigabytes, and the site must not call that «gone»."""

    async def load() -> None:
        try:
            await asyncio.get_running_loop().run_in_executor(None, load_models)
            log.info("models ready")
        except BaseException:  # as before: an agent that cannot load its models stops, and the container is restarted
            log.exception("loading the models failed")
            os._exit(1)

    app["loading"] = asyncio.create_task(load())


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if len(SECRET) < 16 or not TURN_URL:
        raise SystemExit("VOICE_AGENT_SECRET (16+ characters) and WORKSPACE_TURN_URL are required")
    log.info("loading models (the first start downloads the speech model, a few minutes)")
    if TTS_ENGINE == "gemini" and not GEMINI_KEY:
        log.warning("TTS_ENGINE=gemini but GEMINI_API_KEY is empty: the local voice will speak")
    log.info(
        "voice: %s",
        {"edge": f"microsoft {EDGE_VOICE}, local Piper as backup", "gemini": f"gemini {GEMINI_MODEL} / {GEMINI_VOICE}, local Piper as backup"}.get(
            TTS_ENGINE, "local Piper only"
        ),
    )
    log.info("listening on port %s", os.environ.get("PORT", "8080"))
    app = web.Application()
    app.add_routes([web.post("/join", join), web.post("/leave", leave), web.post("/transcript", set_transcript), web.post("/transcribe-note", transcribe_note), web.get("/health", health)])
    app.on_startup.append(load_in_the_background)
    web.run_app(app, port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
