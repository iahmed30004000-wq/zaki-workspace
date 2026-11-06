"""Speech to text through Groq's hosted Whisper (large-v3-turbo): the OWNER's own free key, sent by him in GROQ_API_KEY.

Why: the local recogniser (faster-whisper on this server's shared CPU) took 1 to 29 seconds for a two-second sentence and wrote
«يا مساعد» as «يا موساق». The hosted one answers in a fraction of a second and writes Arabic far better.

⚠️ With this engine on, every sentence of every voice in the room (not the sound of silence) is sent to Groq to be turned into text.
🔧 Off by default (STT_ENGINE=local). Any failure returns None and the caller falls back to the local recogniser, so a meeting never goes deaf.
"""
import io
import json
import logging
import wave

import aiohttp

log = logging.getLogger("voice-agent")

URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def wav_bytes(pcm: bytes, rate: int = 16000) -> bytes:
    """16-bit mono PCM as a WAV file."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def form_for(pcm: bytes, model: str, prompt: str, rate: int = 16000, language: str = "ar") -> aiohttp.FormData:
    form = aiohttp.FormData()
    form.add_field("file", wav_bytes(pcm, rate), filename="speech.wav", content_type="audio/wav")
    form.add_field("model", model)
    form.add_field("language", language)
    form.add_field("response_format", "json")
    form.add_field("temperature", "0")
    if prompt:
        form.add_field("prompt", prompt)
    return form


async def transcribe(http: aiohttp.ClientSession, key: str, pcm: bytes, model: str, prompt: str = "", timeout: float = 12.0):
    """The sentence as text (possibly empty), or None on any failure. Never raises; the key never reaches a log line."""
    try:
        async with http.post(URL, data=form_for(pcm, model, prompt), headers={"authorization": f"Bearer {key}"}, timeout=aiohttp.ClientTimeout(total=timeout)) as res:
            payload = await res.text()
            if res.status != 200:
                log.warning("groq speech-to-text: %s %s", res.status, payload[:200].replace(key, "***"))
                return None
            text = json.loads(payload).get("text")
            return text.strip() if isinstance(text, str) else None
    except Exception as err:
        log.warning("groq speech-to-text failed: %s", str(err).replace(key, "***")[:200])
        return None
