import unittest

import logic


class SignatureTests(unittest.TestCase):
    # the same vector is pinned in tests/assistant-meetings-unit.test.ts: the two sides must sign alike
    VECTOR = ("test-agent-secret-0123456789abcdef", 1800000000, '{"callId":"c1"}', "fbb72a635173d244972f1926cd42d36ead7950de25eace6444ea88c91f0cc4bb")

    def test_sign_and_verify(self):
        secret, ts, body, expected = self.VECTOR
        sig = logic.sign(secret, ts, body)
        self.assertEqual(sig, expected)
        self.assertTrue(logic.verify(secret, str(ts), sig, body, now=ts + 5))
        self.assertFalse(logic.verify(secret, str(ts), sig, body + " ", now=ts + 5))
        self.assertFalse(logic.verify("other-secret-0123456789abcdef", str(ts), sig, body, now=ts + 5))
        self.assertFalse(logic.verify(secret, str(ts), sig, body, now=ts + 600))
        self.assertFalse(logic.verify(secret, None, sig, body, now=ts))
        self.assertFalse(logic.verify(secret, "abc", sig, body, now=ts))


class AddressedTests(unittest.TestCase):
    def test_a_name_addresses_the_assistant(self):
        self.assertTrue(logic.is_addressed("يا مساعد شو رأيك", None, 100.0))
        self.assertTrue(logic.is_addressed("زاكي لخّص لنا", None, 100.0))
        self.assertTrue(logic.is_addressed("المساعد، شو رأيك؟", None, 100.0))
        self.assertTrue(logic.is_addressed("ذكي، لخص", None, 100.0))
        self.assertTrue(logic.is_addressed("يا بوت اكتب هيك", None, 100.0))
        self.assertTrue(logic.is_addressed("وزاكي كمان شو رأيه", None, 100.0))
        self.assertTrue(logic.is_addressed("والمساعد شو رأيه", None, 100.0))
        self.assertFalse(logic.is_addressed("خلينا نكمل بالموضوع", None, 100.0))

    def test_a_name_is_a_whole_word_never_a_piece_of_another_word(self):
        # «المساعدة» is help, «تذكير» is a reminder, «ذكية» is smart (feminine), «مساعدك» is your help: none of them is a call
        for said in ("المساعدة مهمة بالمشروع", "بدنا تذكير للاجتماع", "هاي فكرة ذكية", "شكرا على مساعدتك", "بحتاج مساعدك بالتقرير", "الزاكية بالصف"):
            self.assertFalse(logic.is_addressed(said, None, 100.0), said)
        # «وذكي» (and smart) and «ومساعد» (and somebody's assistant) are ordinary phrases, only the two real names take the glued letter
        self.assertFalse(logic.is_addressed("حل ممتاز وذكي", None, 100.0))
        self.assertFalse(logic.is_addressed("المدير ومساعد المدير", None, 100.0))
        # no piece of the name makes a phrase either
        self.assertFalse(logic.is_addressed("يا ريت بوت", None, 100.0))

    def test_the_minute_after_it_spoke_is_not_a_free_pass_for_everybody(self):
        # the bug of 2026: anything said within 25 seconds after it spoke counted as addressed, so a side talk between two people got an answer
        self.assertFalse(logic.is_addressed("وكمان؟", 90.0, 100.0))
        self.assertFalse(logic.is_addressed("طيب شو رأيك بالموعد", 95.0, 100.0, same_speaker=False))
        self.assertFalse(logic.is_addressed("وكمان؟", None, 100.0, same_speaker=True))

    def test_a_short_follow_up_from_the_same_speaker_is_addressed(self):
        self.assertTrue(logic.is_addressed("وكمان؟", 95.0, 100.0, same_speaker=True))
        self.assertTrue(logic.is_addressed("وكمان؟", 92.0, 100.0, same_speaker=True))  # exactly 8 seconds
        self.assertFalse(logic.is_addressed("وكمان؟", 91.9, 100.0, same_speaker=True))  # a little more than 8
        self.assertFalse(logic.is_addressed("وكمان؟", 75.0, 100.0, same_speaker=True))  # the old 25 seconds are gone
        self.assertEqual(logic.FOLLOW_UP_SECONDS, 8.0)

    def test_a_follow_up_is_short(self):
        twelve = " ".join(["كلمة"] * 12)
        thirteen = " ".join(["كلمة"] * 13)
        self.assertTrue(logic.is_addressed(twelve, 95.0, 100.0, same_speaker=True))
        self.assertFalse(logic.is_addressed(thirteen, 95.0, 100.0, same_speaker=True))
        # a long sentence that names it is still a call
        self.assertTrue(logic.is_addressed(thirteen + " يا مساعد", 95.0, 100.0, same_speaker=False))
        self.assertEqual(logic.FOLLOW_UP_MAX_WORDS, 12)

    def test_the_name_addresses_it_from_anybody_at_any_time(self):
        self.assertTrue(logic.is_addressed("يا مساعد وين وصلنا", 10.0, 100.0, same_speaker=False))
        self.assertTrue(logic.is_addressed("يا مساعد وين وصلنا", None, 100.0, same_speaker=False))

    def test_a_follow_up_belongs_to_one_speaker(self):
        follow = logic.FollowUp()
        self.assertFalse(follow.is_follow_up("p1", 100.0))  # nobody was answered yet
        follow.answered("p1", 100.0)
        self.assertTrue(follow.is_follow_up("p1", 105.0))
        self.assertFalse(follow.is_follow_up("p2", 105.0))  # somebody else in the room
        self.assertFalse(follow.is_follow_up("p1", 109.0))  # too late
        self.assertFalse(follow.is_follow_up(None, 101.0))  # a speaker we cannot tell apart is never a follow-up

    def test_noise(self):
        self.assertTrue(logic.is_noise("اه"))
        self.assertTrue(logic.is_noise("شكرا"))
        self.assertFalse(logic.is_noise("مين بدو يكتب المحضر"))

    def test_an_echo_of_the_recogniser_hint_is_noise_but_a_real_call_is_not(self):
        hint = "اجتماع عمل. المساعد زاكي يشارك فيه."
        self.assertTrue(logic.is_noise("اجتماع عمل.", hint))
        self.assertTrue(logic.is_noise("المساعد زاكي يشارك فيه", hint))
        self.assertFalse(logic.is_noise("يا مساعد، شو رأيك؟", hint))
        self.assertFalse(logic.is_noise("زاكي لخّص لنا الاجتماع", hint))
        self.assertFalse(logic.is_noise("اجتماع عمل", ""))


class SilenceTests(unittest.TestCase):
    def test_an_addressed_silence_is_not_answered(self):
        self.assertTrue(logic.wants_silence("[صمت]"))
        self.assertTrue(logic.wants_silence("  [صمت] "))
        self.assertTrue(logic.wants_silence(""))
        self.assertTrue(logic.wants_silence(None))
        self.assertFalse(logic.wants_silence("أنا معكم، خلينا نبدأ."))
        # the reply of the site for silence is empty: the agent speaks nothing and does not move its follow-up window
        self.assertFalse(logic.should_speak({"reply": "", "silent": True}))
        self.assertFalse(logic.should_speak({"reply": "[صمت]"}))
        self.assertFalse(logic.should_speak({}))
        self.assertTrue(logic.should_speak({"reply": "تمام"}))


class RepeatRequestIsGoneTests(unittest.TestCase):
    def test_the_agent_never_invents_a_sentence_of_its_own(self):
        import pathlib

        source = pathlib.Path(__file__).with_name("agent.py").read_text(encoding="utf8")
        self.assertNotIn("لم أفهم جيدًا", source)



if __name__ == "__main__":
    unittest.main()
