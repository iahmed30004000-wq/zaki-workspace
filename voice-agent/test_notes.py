"""The signed transcription door of a voice note (notes.py): signature, limits, decoding command, turn taking. No model, no ffmpeg, no network."""
import asyncio
import hashlib
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

import logic
import notes

SECRET = "test-agent-secret-0123456789abcdef"
TS = 1800000000
AUDIO = b"abc"
SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
# the same vectors are pinned in tests/gpu-voice-site.test.ts: the site and the agent must sign alike
NOTE_SIGNATURE = "87fc0ceea2108d232326eed3c311ea181da7325c283402462516c3d5660d6a8a"
HEALTH_SIGNATURE = "4418da527a3be7c7aa8ffc5fc6002c3f3f1955341ab208d01845cc07a0107c71"


def run(coro):
    return asyncio.run(coro)


def headers(sha=SHA, language="ar", ts=TS, signature=None):
    out = {"x-agent-timestamp": str(ts), "x-agent-audio-sha256": sha, "x-agent-language": language}
    out["x-agent-signature"] = signature if signature is not None else logic.sign(SECRET, ts, notes.signed_text(sha, language))
    return out


class SignatureTests(unittest.TestCase):
    def test_the_shared_vectors(self):
        self.assertEqual(hashlib.sha256(AUDIO).hexdigest(), SHA)
        self.assertEqual(logic.sign(SECRET, TS, notes.signed_text(SHA, "ar")), NOTE_SIGNATURE)
        self.assertEqual(logic.sign(SECRET, TS, notes.HEALTH_TEXT), HEALTH_SIGNATURE)

    def test_a_good_request_is_accepted_before_a_byte_of_audio_is_read(self):
        self.assertEqual(notes.check_headers(SECRET, headers(), now=TS + 5), (SHA, "ar"))
        self.assertEqual(notes.check_headers(SECRET, headers(language=""), now=TS), (SHA, None))

    def test_everything_else_is_refused(self):
        for bad in (
            headers(signature="0" * 64),
            headers(ts=TS - 600),
            {k: v for k, v in headers().items() if k != "x-agent-audio-sha256"},
            {k: v for k, v in headers().items() if k != "x-agent-signature"},
            headers(sha="zz"),
            {**headers(), "x-agent-language": "en"},  # the language is signed
            {**headers(), "x-agent-audio-sha256": "0" * 64},  # and so is the hash of the audio
            headers(language="arabic!"),
        ):
            self.assertIsNone(notes.check_headers(SECRET, bad, now=TS), bad)
        self.assertIsNone(notes.check_headers("", headers(), now=TS))

    def test_the_audio_must_be_the_signed_audio(self):
        self.assertTrue(notes.body_matches(AUDIO, SHA))
        self.assertFalse(notes.body_matches(AUDIO + b"x", SHA))

    def test_a_signature_of_one_door_never_opens_another(self):
        body = '{"callId":"c1"}'
        self.assertIsNone(notes.check_headers(SECRET, headers(signature=logic.sign(SECRET, TS, body)), now=TS))
        self.assertFalse(logic.verify(SECRET, str(TS), NOTE_SIGNATURE, body, now=TS))

    def test_the_health_signature_tells_whether_the_two_secrets_match(self):
        good = {"x-agent-timestamp": str(TS), "x-agent-signature": HEALTH_SIGNATURE}
        self.assertIs(notes.secret_matches(SECRET, good, now=TS), True)
        self.assertIs(notes.secret_matches("another-secret-0123456789abcdef", good, now=TS), False)
        self.assertIsNone(notes.secret_matches(SECRET, {}, now=TS))  # an unsigned look (the container's own health check) says nothing


class AudioTests(unittest.TestCase):
    def test_what_the_chat_records_is_recognised_by_its_first_bytes(self):
        for head, demuxer in (
            (b"\x1a\x45\xdf\xa3" + b"\0" * 20 + b"webm", "matroska"),  # webm / opus (Chrome, Android)
            (b"OggS" + b"\0" * 24, "ogg"),
            (b"\0\0\0\x1cftypM4A " + b"\0" * 12, "mp4"),  # mp4 / aac (Safari, iPhone)
            (b"RIFF\0\0\0\0WAVEfmt " + b"\0" * 12, "wav"),
            (b"\xff\xf1\x50\x80" + b"\0" * 24, "aac"),  # a bare aac stream
            (b"ID3\x04" + b"\0" * 24, "mp3"),
            (b"\xff\xfb\x90\x00" + b"\0" * 24, "mp3"),
        ):
            self.assertEqual(notes.container_of(head), demuxer, head[:8])

    def test_a_playlist_or_any_other_file_is_not_a_recording(self):
        for head in (b"#EXTM3U\n#EXT-X-VERSION:3\n", b"ffconcat version 1.0\nfile '/etc/passwd'\n", b"%PDF-1.7", b"<html>", b"", b"\xff\xff\xff\xff"):
            self.assertIsNone(notes.container_of(head), head[:12])

    def test_the_decode_is_bounded_and_may_open_nothing_but_the_recording(self):
        args = notes.ffmpeg_args("matroska", "/proc/self/fd/7")
        self.assertEqual(args[0], "ffmpeg")
        self.assertEqual(args[args.index("-protocol_whitelist") + 1], "file,pipe")
        self.assertEqual(args[args.index("-f") + 1], "matroska")  # the demuxer is forced: never guessed from the content
        self.assertEqual(args[args.index("-i") + 1], "/proc/self/fd/7")
        self.assertEqual(args[args.index("-t") + 1], str(notes.MAX_NOTE_SECONDS + 1))
        for flag in ("-vn", "-nostdin"):
            self.assertIn(flag, args)
        self.assertEqual(args[-1], "pipe:1")
        self.assertEqual(args[args.index("-ar") + 1], "16000")

    def test_the_limits(self):
        self.assertEqual(notes.MAX_NOTE_BYTES, 25 * 1024 * 1024)
        self.assertGreaterEqual(notes.MAX_NOTE_SECONDS, 300)  # a voice note is at most five minutes
        self.assertLess(notes.NOTE_DEADLINE_SECONDS, 120)  # the site gives up at 120 seconds: the agent stops first
        self.assertEqual(notes.pcm_seconds(32000), 1.0)

    def test_the_body_is_read_only_up_to_the_limit(self):
        async def chunks(parts):
            for part in parts:
                yield part

        self.assertEqual(run(notes.read_limited(chunks([b"ab", b"cd"]), 4)), b"abcd")
        self.assertIsNone(run(notes.read_limited(chunks([b"ab", b"cd", b"e"]), 4)))


class GateTests(unittest.TestCase):
    def test_one_note_at_a_time_a_short_line_and_the_rest_are_told_busy(self):
        async def scenario():
            gate = notes.NoteGate(waiting=1)
            order, release = [], asyncio.Event()

            async def note(name, hold=False):
                async with gate.turn():
                    order.append(f"start {name}")
                    if hold:
                        await release.wait()
                    order.append(f"end {name}")

            first = asyncio.create_task(note("a", hold=True))
            await asyncio.sleep(0)
            second = asyncio.create_task(note("b"))
            await asyncio.sleep(0)
            with self.assertRaises(notes.Busy):
                await note("c")
            release.set()
            await asyncio.gather(first, second)
            await note("d")  # the line is free again
            return order

        self.assertEqual(run(scenario()), ["start a", "end a", "start b", "end b", "start d", "end d"])


class DrainTests(unittest.TestCase):
    def test_a_meeting_sentence_gets_the_recogniser_between_two_pieces_of_a_note(self):
        """The recogniser has ONE worker. A note hands it one piece at a time, so a sentence said meanwhile waits for one piece, not for the whole note."""
        order = []
        pool = ThreadPoolExecutor(max_workers=1)

        async def scenario():
            loop = asyncio.get_running_loop()
            meeting = []

            def on_pool(fn):
                return loop.run_in_executor(pool, fn)

            def pieces():
                for i in range(3):
                    if i == 0:
                        # somebody speaks in a meeting while the first piece is being written
                        queued = threading.Event()

                        def speak():
                            meeting.append(loop.run_in_executor(pool, order.append, "meeting sentence"))
                            queued.set()

                        loop.call_soon_threadsafe(speak)
                        assert queued.wait(5)
                    order.append(f"piece {i}")
                    yield f" part{i} "

            text = await notes.drain(pieces, on_pool, deadline=10**9, clock=lambda: 0)
            await meeting[-1]
            return text

        self.assertEqual(run(scenario()), "part0 part1 part2")
        pool.shutdown()
        self.assertEqual(order, ["piece 0", "meeting sentence", "piece 1", "piece 2"])

    def test_a_note_that_takes_too_long_stops_pulling(self):
        pulled, now = [], [0.0]

        def pieces():
            for i in range(100):
                pulled.append(i)
                now[0] += 40
                yield str(i)

        async def inline(fn):
            return fn()

        with self.assertRaises(notes.TooSlow):
            run(notes.drain(pieces, inline, deadline=100, clock=lambda: now[0]))
        self.assertLess(len(pulled), 5)

    def test_a_note_that_waited_past_its_time_never_starts(self):
        started = []

        async def inline(fn):
            return fn()

        with self.assertRaises(notes.TooSlow):
            run(notes.drain(lambda: started.append(1) or iter(()), inline, deadline=5, clock=lambda: 6))
        self.assertEqual(started, [])


class TextTests(unittest.TestCase):
    def test_only_the_recognisers_known_inventions_are_dropped(self):
        self.assertEqual(notes.clean_note("شكرا"), "شكرا")  # a real voice note may say only this
        self.assertEqual(notes.clean_note("اه"), "اه")
        self.assertEqual(notes.clean_note("اشتركوا في القناة"), "")
        self.assertEqual(notes.clean_note("  ترجمة نانسي قنقر. "), "")
        self.assertEqual(notes.clean_note("  بكرا بنلتقي الساعة عشرة  "), "بكرا بنلتقي الساعة عشرة")
        self.assertEqual(len(notes.clean_note("ا" * (notes.MAX_NOTE_CHARS + 10))), notes.MAX_NOTE_CHARS)

    def test_beam_is_wider_only_where_there_is_a_card(self):
        self.assertEqual(notes.note_options("cuda", "ar")["beam_size"], 5)
        self.assertEqual(notes.note_options("cpu", "ar")["beam_size"], 1)
        options = notes.note_options("cpu", None)
        self.assertIsNone(options["language"])
        self.assertTrue(options["vad_filter"])
        self.assertFalse(options["condition_on_previous_text"])
        self.assertNotIn("initial_prompt", options)  # the meeting's hint does not belong in a person's note


if __name__ == "__main__":
    unittest.main()
