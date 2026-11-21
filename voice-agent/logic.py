"""The parts of the voice agent that need no sound card, no model and no network, so they can be tested alone."""
import hashlib
import hmac
import re
import time

MAX_AGE_SECONDS = 60

# the assistant answers only when it is spoken to: its name (a whole word), or a short follow-up from the SAME person it has just answered
WAKE_WORDS = ("مساعد", "المساعد", "زاكي", "ذكي", "يا بوت")
# one letter that Arabic glues to the front of a word («و» and, «ف» so): «وزاكي» is still the name, «بذكي» or «للمساعد» are not matched
WAKE_PREFIXES = ("و", "ف")
# 8 seconds, not 25: a longer window made a side talk between two other people look like a question to the assistant
FOLLOW_UP_SECONDS = 8.0
SILENCE = "[صمت]"


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


def _tokens(text: str) -> list[str]:
    """The words of a sentence (letters and digits; punctuation, Arabic comma and question mark are not part of a word)."""
    return re.findall(r"\w+", normalize(text))


_WAKE_PHRASES = tuple(tuple(_tokens(w)) for w in WAKE_WORDS)


def is_named(text: str) -> bool:
    """Is the assistant's name in the sentence AS A WHOLE WORD? «المساعدة» (help), «تذكير» (a reminder) and «ذكية» (smart) are not its name."""
    words = _tokens(text)
    for phrase in _WAKE_PHRASES:
        size = len(phrase)
        if size == 0:
            continue
        for i in range(len(words) - size + 1):
            window = tuple(words[i : i + size])
            if window == phrase:
                return True
            if size == 1 and any(window[0] == prefix + phrase[0] for prefix in WAKE_PREFIXES):
                return True
    return False


def is_addressed(text: str, last_spoke_at: float | None, now: float, same_speaker: bool = False) -> bool:
    """Was this said to the assistant? Its name as a whole word, or a short follow-up (FOLLOW_UP_SECONDS) from the SAME person it has just answered.
    What other people say in that window is not for it, however soon after it spoke."""
    if is_named(text):
        return True
    return same_speaker and last_spoke_at is not None and 0 <= now - last_spoke_at <= FOLLOW_UP_SECONDS


class FollowUp:
    """Who the assistant answered last, and when it finished: only that person's next short sentence is a follow-up."""

    def __init__(self) -> None:
        self.speaker = None
        self.at = None

    def answered(self, speaker, at: float) -> None:
        self.speaker, self.at = speaker, at

    def is_follow_up(self, speaker, now: float) -> bool:
        return speaker is not None and speaker == self.speaker and self.at is not None and 0 <= now - self.at <= FOLLOW_UP_SECONDS


def wants_silence(reply) -> bool:
    """The model's «[صمت]» (or nothing): the assistant stays quiet, even when it was named. It never says a sentence of its own instead."""
    return reply is None or reply.strip() == "" or SILENCE in reply


def should_speak(answer: dict) -> bool:
    """The site's answer to a turn: speak only a real reply (the site sends an empty one for silence)."""
    return not answer.get("silent") and not wants_silence(answer.get("reply"))


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
