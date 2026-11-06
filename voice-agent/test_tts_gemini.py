import base64
import io
import unittest
import wave

import tts_gemini


def wav_bytes(rate=24000, frames=2000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * frames)
    return buf.getvalue()


class ExtractTests(unittest.TestCase):
    def test_interactions_answer_with_a_wav(self):
        answer = {"steps": [{"content": [{"type": "audio", "data": base64.b64encode(wav_bytes()).decode()}]}]}
        pcm, rate = tts_gemini.extract_pcm(answer)
        self.assertEqual(rate, 24000)
        self.assertEqual(len(pcm), 4000)

    def test_generate_content_answer_with_raw_pcm(self):
        raw = b"\x02\x00" * 3000
        answer = {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(raw).decode()}}]}}]}
        self.assertEqual(tts_gemini.extract_pcm(answer), (raw, 24000))

    def test_a_wav_at_another_rate_keeps_its_rate(self):
        answer = {"x": {"data": base64.b64encode(wav_bytes(rate=16000)).decode()}}
        self.assertEqual(tts_gemini.extract_pcm(answer)[1], 16000)

    def test_no_audio_gives_none(self):
        self.assertIsNone(tts_gemini.extract_pcm({"error": "no"}))
        self.assertIsNone(tts_gemini.extract_pcm({"steps": [{"content": [{"type": "text", "data": "hello"}]}]}))
        self.assertIsNone(tts_gemini.extract_pcm({"data": "not base64 !!!"}))
        self.assertIsNone(tts_gemini.extract_pcm({"data": base64.b64encode(b"short").decode()}))


class RequestTests(unittest.TestCase):
    def test_interactions_request_carries_text_style_and_voice(self):
        url, body = tts_gemini.interactions_request("مرحبا", "gemini-3.8-flash-lite-tts", "Kore")
        self.assertTrue(url.endswith("/v1beta/interactions"))
        self.assertEqual(body["model"], "gemini-3.8-flash-lite-tts")
        self.assertEqual(body["input"][0]["content"][0]["text"], "مرحبا")
        self.assertEqual(body["generation_config"]["speech_config"][0]["voice"], "Kore")
        self.assertNotIn("key", str(body).lower())

    def test_generate_content_request_asks_for_audio_with_the_voice(self):
        url, body = tts_gemini.generate_content_request("مرحبا", "gemini-2.5-flash-preview-tts", "Kore")
        self.assertTrue(url.endswith("/models/gemini-2.5-flash-preview-tts:generateContent"))
        self.assertEqual(body["generationConfig"]["responseModalities"], ["AUDIO"])
        self.assertEqual(body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], "Kore")


if __name__ == "__main__":
    unittest.main()
