"""The signed door that writes the words of a VOICE NOTE (POST /transcribe-note). Standard library only, so it is tested without a model (test_notes.py).

    the site    sends the recording as the body, with its SHA-256 in a header, signed the same way as the other doors:
                HMAC-SHA256(secret, "<unix seconds>.transcribe:<sha256 of the audio>:<language>")   (src/server/calls/agent-link.ts)
    the agent   checks the signature BEFORE reading a byte, reads at most MAX_NOTE_BYTES, checks the hash, decodes in memory, and hands the
                recogniser ONE piece at a time, so a sentence said in a meeting waits for one piece and never for the whole note.

NOTHING is stored and nothing said is logged: the audio and the words live in memory for the length of the request. The note is always written by the
recogniser on THIS server, whatever STT_ENGINE says about meetings.
"""
import asyncio
import contextlib
import hashlib
import re
import time

import logic

MAX_NOTE_BYTES = 25 * 1024 * 1024  # the site's own ceiling (MAX_TRANSCRIBE_BYTES); a voice note itself is at most 10 MB
MAX_NOTE_SECONDS = 360  # a voice note is at most five minutes
NOTE_DEADLINE_SECONDS = 100  # the site gives up at 120 seconds, so the agent stops working first
DECODE_TIMEOUT_SECONDS = 30
NOTE_WAITING_MAX = 2  # one being written and this many behind it; the next one is told «busy»
MAX_NOTE_CHARS = 20_000
RATE = 16000
HEALTH_TEXT = "health"  # what a signed look at /health signs: the answer then says whether the two secrets match


class Busy(Exception):
    pass


class TooSlow(Exception):
    pass


def signed_text(sha256_hex: str, language: str | None) -> str:
    # the «transcribe:» prefix is never valid JSON, so a signature of this door opens no other one, and theirs does not open this one
    return f"transcribe:{sha256_hex}:{language or ''}"


def check_headers(secret: str, headers, now: float | None = None):
    """(sha256 of the audio, language or None) when the request is signed with our secret and fresh; otherwise None."""
    sha = headers.get("x-agent-audio-sha256") or ""
    language = headers.get("x-agent-language") or ""
    if not secret or not re.fullmatch(r"[0-9a-f]{64}", sha) or not re.fullmatch(r"(?:[a-z]{2,3})?", language):
        return None
    if not logic.verify(secret, headers.get("x-agent-timestamp"), headers.get("x-agent-signature"), signed_text(sha, language), now):
        return None
    return sha, language or None


def secret_matches(secret: str, headers, now: float | None = None) -> bool | None:
    """A signed look at /health: True or False; None for a plain look (the container's own health check)."""
    if not headers.get("x-agent-signature"):
        return None
    return bool(secret) and logic.verify(secret, headers.get("x-agent-timestamp"), headers.get("x-agent-signature"), HEALTH_TEXT, now)


def body_matches(audio: bytes, sha256_hex: str) -> bool:
    return hashlib.sha256(audio).hexdigest() == sha256_hex


async def read_limited(chunks, limit: int = MAX_NOTE_BYTES) -> bytes | None:
    """The body, or None as soon as it passes the limit."""
    out = bytearray()
    async for chunk in chunks:
        out += chunk
        if len(out) > limit:
            return None
    return bytes(out)


def container_of(head: bytes) -> str | None:
    """The ffmpeg demuxer for what a chat records, from its first bytes. Anything else (a playlist that names other files, a document) is refused."""
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "matroska"  # webm / opus
    if head[:4] == b"OggS":
        return "ogg"
    if head[4:8] == b"ftyp":
        return "mp4"  # mp4 / aac
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:3] == b"ID3":
        return "mp3"
    if len(head) > 2 and head[0] == 0xFF:
        if head[1] & 0xF6 == 0xF0:
            return "aac"  # a bare ADTS stream
        if head[1] & 0xE0 == 0xE0 and head[1] != 0xFF and head[1] & 0x06 and head[2] != 0xFF:
            return "mp3"
    return None


def ffmpeg_args(demuxer: str, input_path: str) -> list[str]:
    """Decode to 16 kHz mono 16-bit sound on the output pipe. The demuxer is forced, only the recording itself may be opened, and the length is
    cut one second past the limit (so «too long» is seen, and a tiny file that unfolds into hours stops there)."""
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "file,pipe",
        "-f", demuxer, "-i", input_path,
        "-map", "0:a:0", "-vn",
        "-t", str(MAX_NOTE_SECONDS + 1),
        "-ac", "1", "-ar", str(RATE),
        "-f", "s16le", "pipe:1",
    ]


def pcm_seconds(nbytes: int) -> float:
    return nbytes / (RATE * 2)


class NoteGate:
    """One note at a time, a short line behind it."""

    def __init__(self, waiting: int = NOTE_WAITING_MAX) -> None:
        self.max_waiting, self.waiting = waiting, 0
        self.lock = asyncio.Lock()

    @contextlib.asynccontextmanager
    async def turn(self):
        if self.lock.locked() and self.waiting >= self.max_waiting:
            raise Busy()
        self.waiting += 1
        try:
            await self.lock.acquire()
        finally:
            self.waiting -= 1
        try:
            yield
        finally:
            self.lock.release()


async def drain(start, run, deadline: float, clock=time.monotonic) -> str:
    """The words of one note. `start()` gives the recogniser's lazy pieces of text; `run(fn)` runs fn on the recogniser's ONE worker, the same one a
    meeting uses. Each piece is a job of its own, so whatever a meeting queued meanwhile goes in between."""

    def check() -> None:
        if clock() > deadline:
            raise TooSlow()

    check()
    pieces = await run(lambda: iter(start()))
    out = []
    while True:
        check()
        piece = await run(lambda: next(pieces, None))
        if piece is None:
            break
        out.append(piece.strip())
    return " ".join(p for p in out if p)


# what the recogniser invents out of music and silence. A real note may well be one short word («شكرا»), so nothing else is dropped.
_INVENTED = frozenset(logic.normalize(s) for s in ("اشتركوا في القناة", "اشتركوا بالقناة", "لا تنسوا الاشتراك في القناة", "ترجمة نانسي قنقر"))


def clean_note(text: str) -> str:
    text = (text or "").strip()
    plain = logic.normalize(re.sub(r"[.,،!؟?:؛]", " ", text))
    return "" if plain in _INVENTED else text[:MAX_NOTE_CHARS]


def note_options(device: str, language: str | None) -> dict:
    """How faster-whisper writes a note: a wider search only where there is a card (on the processor it would hold the recogniser too long)."""
    return {"language": language, "beam_size": 5 if device == "cuda" else 1, "vad_filter": True, "condition_on_previous_text": False}
