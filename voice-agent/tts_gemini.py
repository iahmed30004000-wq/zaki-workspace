"""
The natural voice of «المساعد بالاجتماعات»: Google's Gemini speech models, which have a free tier and speak Standard Arabic (فصحى) well.

It is OPTIONAL and off until the owner puts his own key in GEMINI_API_KEY. The answer text (already filtered by the workspace: phone numbers,
emails and links are removed) is sent to Google to be turned into sound; nothing else is. If the call fails for any reason (no quota, no network,
a changed API) the caller speaks with the local Piper voice instead, so the meeting never goes quiet.

Two request shapes are tried in order: the current Interactions API, then the older generateContent one (a different model).
"""
import base64
import io
import json
import logging
import wave

import aiohttp

log = logging.getLogger("voice-agent")

BASE = "https://generativelanguage.googleapis.com/v1beta"
STYLE = "calm, clear and friendly, in Modern Standard Arabic"


def _strings_under(node, key):
    """Every string found under a key called `key`, anywhere in a JSON answer."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key and isinstance(v, str):
                yield v
            else:
                yield from _strings_under(v, key)
    elif isinstance(node, list):
        for item in node:
            yield from _strings_under(item, key)


def extract_pcm(answer: dict):
    """(16-bit mono PCM bytes, sample rate) from either answer shape, or None."""
    for text in _strings_under(answer, "data"):
        try:
            raw = base64.b64decode(text, validate=True)
        except Exception:
            continue
        if len(raw) < 1000:
            continue
        if raw[:4] == b"RIFF":
            try:
                with wave.open(io.BytesIO(raw)) as w:
                    if w.getsampwidth() == 2 and w.getnchannels() == 1:
                        return w.readframes(w.getnframes()), w.getframerate()
            except Exception:
                continue
        else:
            return raw, 24000  # headerless audio/l16 is 24 kHz mono
    return None


def interactions_request(text: str, model: str, voice: str):
    return (
        f"{BASE}/interactions",
        {
            "model": model,
            "input": [{"type": "user_input", "content": [{"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice}]},
        },
    )


def generate_content_request(text: str, model: str, voice: str):
    return (
        f"{BASE}/models/{model}:generateContent",
        {
            "contents": [{"parts": [{"text": f"Say in {STYLE}: {text}"}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        },
    )


async def synthesize(http: aiohttp.ClientSession, key: str, text: str, model: str, fallback_model: str, voice: str, timeout: float = 20.0):
    """(PCM, rate) or None. Never raises: a failure is logged (without the key) and the caller falls back."""
    attempts = [interactions_request(text, model, voice), generate_content_request(text, fallback_model, voice)]
    for url, body in attempts:
        try:
            async with http.post(
                url, data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "content-type": "application/json"}, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as res:
                payload = await res.text()
                if res.status != 200:
                    log.warning("gemini voice %s: %s %s", url.rsplit("/", 1)[-1].split(":")[0], res.status, payload[:300].replace(key, "***"))
                    if res.status in (401, 403, 429):  # a bad key or no quota: the other shape would fail the same way
                        return None
                    continue
                audio = extract_pcm(json.loads(payload))
                if audio:
                    return audio
                log.warning("gemini voice: answered without audio")
        except Exception as err:
            log.warning("gemini voice failed: %s", str(err).replace(key, "***")[:200])
            return None
    return None
