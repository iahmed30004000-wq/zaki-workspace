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
    def test_wake_words_and_follow_up(self):
        self.assertTrue(logic.is_addressed("يا مساعد شو رأيك", None, 100.0))
        self.assertTrue(logic.is_addressed("زاكي لخّص لنا", None, 100.0))
        self.assertFalse(logic.is_addressed("خلينا نكمل بالموضوع", None, 100.0))
        self.assertTrue(logic.is_addressed("وكمان؟", 90.0, 100.0))
        self.assertFalse(logic.is_addressed("وكمان؟", 10.0, 100.0))

    def test_noise(self):
        self.assertTrue(logic.is_noise("اه"))
        self.assertTrue(logic.is_noise("شكرا"))
        self.assertFalse(logic.is_noise("مين بدو يكتب المحضر"))


if __name__ == "__main__":
    unittest.main()
