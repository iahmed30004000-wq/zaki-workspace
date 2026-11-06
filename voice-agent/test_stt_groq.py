import asyncio
import io
import unittest
import wave

import stt_groq

KEY = "gsk_test-key-never-logged-0123456789"  # scan-secrets:ignore


class FakeResponse:
    def __init__(self, status, body):
        self.status, self._body = status, body

    async def text(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class FakeHttp:
    def __init__(self, status=200, body='{"text": " يا مساعد، شو رأيك؟ "}', error=None):
        self.status, self.body, self.error, self.calls = status, body, error, []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return FakeResponse(self.status, self.body)


def run(coro):
    return asyncio.run(coro)


class WavTests(unittest.TestCase):
    def test_wav_has_the_rate_and_the_samples(self):
        data = stt_groq.wav_bytes(b"\x01\x00" * 1600, 16000)
        with wave.open(io.BytesIO(data)) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()), (1, 2, 16000, 1600))


class TranscribeTests(unittest.TestCase):
    def test_returns_the_trimmed_text_and_sends_key_only_in_the_header(self):
        http = FakeHttp()
        text = run(stt_groq.transcribe(http, KEY, b"\x00\x00" * 1600, "whisper-large-v3-turbo", "اجتماع"))
        self.assertEqual(text, "يا مساعد، شو رأيك؟")
        url, kwargs = http.calls[0]
        self.assertTrue(url.startswith("https://api.groq.com/openai/v1/"))
        self.assertEqual(kwargs["headers"]["authorization"], f"Bearer {KEY}")
        self.assertNotIn("authorization", {k.lower() for k in kwargs} - {"headers"})

    def test_a_refusal_gives_none_and_the_key_stays_out_of_the_log(self):
        for status in (401, 429, 500):
            http = FakeHttp(status=status, body=f"bad {KEY}")
            with self.assertLogs("voice-agent", level="WARNING") as logs:
                self.assertIsNone(run(stt_groq.transcribe(http, KEY, b"\x00\x00" * 1600, "m")))
            self.assertNotIn(KEY, "\n".join(logs.output))

    def test_an_exception_or_a_strange_answer_gives_none(self):
        with self.assertLogs("voice-agent", level="WARNING") as logs:
            self.assertIsNone(run(stt_groq.transcribe(FakeHttp(error=OSError(f"down {KEY}")), KEY, b"\x00\x00", "m")))
        self.assertNotIn(KEY, "\n".join(logs.output))
        with self.assertLogs("voice-agent", level="WARNING"):
            self.assertIsNone(run(stt_groq.transcribe(FakeHttp(body="<html>"), KEY, b"\x00\x00", "m")))
        self.assertIsNone(run(stt_groq.transcribe(FakeHttp(body='{"text": 5}'), KEY, b"\x00\x00", "m")))


if __name__ == "__main__":
    unittest.main()
