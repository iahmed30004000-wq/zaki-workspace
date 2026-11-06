"""The parts of the voice agent that need no sound card, no model and no network, so they can be tested alone."""
import hashlib
import hmac
import re
import time

MAX_AGE_SECONDS = 60

# the assistant answers only when it is spoken to: its name, or the minute right after it spoke
WAKE_WORDS = ("مساعد", "المساعد", "زاكي", "ذكي", "يا بوت")
FOLLOW_UP_SECONDS = 25.0


def sign(secret: str, timestamp: int, body: str) -> str:
    """HMAC-SHA256 hex over '<unix seconds>.<body>': the same rule as src/server/calls/assistant-agent.ts `signBody`."""
    return hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()


def verify(secret: str, timestamp_header, signature_header, body: str, now: float | None = None) -> bool:
    if not timestamp_header or not signature_header or not re.fullmatch(r"\d{9,12}", timestamp_header):
        return False
    ts = int(timestamp_header)
    if abs((time.time() if now is None else now) - ts) > MAX_AGE_SECONDS:
        return False
    return hmac.compare_digest(sign(secret, ts, body), signature_header)


def normalize(text: str) -> str:
    """Arabic text as people say it: no diacritics, alef variants and the tatweel unified, one space between words."""
    text = re.sub(r"[ً-ٰٟـ]", "", text)
    text = re.sub(r"[إأآ]", "ا", text)
    return re.sub(r"\s+", " ", text).strip()


def is_addressed(text: str, last_spoke_at: float | None, now: float) -> bool:
    """Was this said to the assistant? Its name anywhere, or within a short while after it spoke."""
    if last_spoke_at is not None and now - last_spoke_at <= FOLLOW_UP_SECONDS:
        return True
    words = normalize(text)
    return any(normalize(w) in words for w in WAKE_WORDS)


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[.,،!؟?:؛]", " ", normalize(text))).strip()


def is_noise(text: str, prompt: str = "") -> bool:
    """Speech to text invents words out of silence and music: very short results and the few phrases it repeats are dropped.
    A hint given to the recogniser (the names it should know) is sometimes echoed back out of silence: an answer that is only a piece of it is noise too."""
    cleaned = normalize(text)
    if len(cleaned) < 3:
        return True
    if cleaned in {"شكرا", "شكرا لكم", "اشتركوا في القناة", "ترجمة نانسي قنقر"}:
        return True
    hint = _plain(prompt)
    return bool(hint) and _plain(text) in hint
