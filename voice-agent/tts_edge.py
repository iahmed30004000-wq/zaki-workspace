"""
Microsoft Edge's neural voices, through the free `edge-tts` package (no key, no account).

The owner picked it for Standard Arabic (فصحى). The answer text (already filtered by the workspace: phone numbers, emails and links removed) is
sent to Microsoft to be turned into sound; nothing else is. The service is unofficial, so it can change or refuse: any failure returns None and
the caller speaks with the local Piper voice instead. TTS_ENGINE=piper turns this off completely.

The service answers with MP3; ffmpeg turns it into the 24 kHz 16-bit mono sound the room wants.
"""
import asyncio
import logging

import edge_tts

log = logging.getLogger("voice-agent")

OUT_RATE = 24000


async def mp3_to_pcm(mp3: bytes):
    """16-bit mono PCM at 24 kHz, or None when ffmpeg is missing or fails."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", str(OUT_RATE), "-ac", "1", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        pcm, err = await proc.communicate(mp3)
    except Exception as e:
        log.warning("ffmpeg could not run: %s", e)
        return None
    if proc.returncode != 0 or len(pcm) < 1000:
        log.warning("ffmpeg could not decode the voice: %s", err.decode("utf8", "replace")[:200])
        return None
    return pcm


async def _fetch(text: str, voice: str, rate: str) -> bytes:
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    return bytes(audio)


async def synthesize(text: str, voice: str, rate: str = "+0%", timeout: float = 20.0):
    """(PCM, 24000) or None. Never raises: a failure is logged and the caller falls back."""
    try:
        mp3 = await asyncio.wait_for(_fetch(text, voice, rate), timeout)
    except Exception as err:
        log.warning("edge voice failed: %s %s", type(err).__name__, str(err)[:200])
        return None
    if not mp3:
        log.warning("edge voice answered without audio")
        return None
    pcm = await mp3_to_pcm(mp3)
    return (pcm, OUT_RATE) if pcm else None
