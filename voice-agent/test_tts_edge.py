import asyncio
import shutil
import unittest
from unittest import mock

import tts_edge


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FailureTests(unittest.TestCase):
    """Whatever goes wrong, the answer is None (the caller then speaks with the local voice) and never an exception."""

    def test_service_error_gives_none(self):
        async def boom(*_a):
            raise RuntimeError("403")

        with mock.patch.object(tts_edge, "_fetch", boom):
            self.assertIsNone(run(tts_edge.synthesize("مرحبا", "ar-SA-HamedNeural")))

    def test_slow_service_gives_none(self):
        async def slow(*_a):
            await asyncio.sleep(5)

        with mock.patch.object(tts_edge, "_fetch", slow):
            self.assertIsNone(run(tts_edge.synthesize("مرحبا", "ar-SA-HamedNeural", timeout=0.05)))

    def test_empty_answer_gives_none(self):
        async def empty(*_a):
            return b""

        with mock.patch.object(tts_edge, "_fetch", empty):
            self.assertIsNone(run(tts_edge.synthesize("مرحبا", "ar-SA-HamedNeural")))

    def test_undecodable_audio_gives_none(self):
        async def junk(*_a):
            return b"not an mp3" * 200

        with mock.patch.object(tts_edge, "_fetch", junk):
            self.assertIsNone(run(tts_edge.synthesize("مرحبا", "ar-SA-HamedNeural")))


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is not installed here")
class DecodeTests(unittest.TestCase):
    def test_a_real_mp3_becomes_24k_mono_pcm(self):
        import subprocess

        mp3 = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "mp3", "pipe:1"], capture_output=True, check=True
        ).stdout
        pcm = run(tts_edge.mp3_to_pcm(mp3))
        self.assertIsNotNone(pcm)
        self.assertAlmostEqual(len(pcm) / 2 / 24000, 1.0, delta=0.15)  # one second of 16-bit samples at 24 kHz


if __name__ == "__main__":
    unittest.main()
