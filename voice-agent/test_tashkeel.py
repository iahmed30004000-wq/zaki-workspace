import unittest

import numpy as np

import tashkeel

KASRA = "ِ"
FATHA = "َ"
SHADDA = "ّ"

INPUT_MAP = {c: i for i, c in enumerate("_ #!\"().:،؟ءآأؤإئابتثجحخدذرزسشصضطظعغفقكلمنهويىة")}
HINT_MAP = {"_": 0, "": 1, FATHA: 5, KASRA: 7, FATHA + SHADDA: 11}
TARGET_MAP = {"_": 0, "": 1, FATHA: 5, KASRA: 7, FATHA + SHADDA: 11}


class FakeSession:
    """Stands in for onnxruntime: puts a kasra on «ب», a fatha on «م», and nothing on the rest. It records what it was fed."""

    def __init__(self):
        self.fed = []

    class _Input:
        def __init__(self, name):
            self.name = name

    def get_inputs(self):
        return [self._Input("input_ids"), self._Input("diac_ids"), self._Input("input_length")]

    def run(self, _outputs, feed):
        self.fed.append(feed)
        ids = feed["input_ids"][0]
        reverse = {i: c for c, i in INPUT_MAP.items()}
        marks = [TARGET_MAP[KASRA] if reverse[int(i)] == "ب" else TARGET_MAP[FATHA] if reverse[int(i)] == "م" else TARGET_MAP[""] for i in ids]
        return [np.array([marks], dtype=np.uint8), np.zeros((1, len(marks)), dtype=np.float32)]


def make():
    session = FakeSession()
    return tashkeel.Tashkeel(session, INPUT_MAP, HINT_MAP, TARGET_MAP), session


class HelperTests(unittest.TestCase):
    def test_marks_are_split_from_letters(self):
        chars, marks = tashkeel._split_marks("بِسْم", HINT_MAP)
        self.assertEqual(chars, ["ب", "س", "م"])
        self.assertEqual(marks, [KASRA, "", ""])  # the sukun is not a known hint, so it is dropped

    def test_leading_marks_and_empty_text(self):
        self.assertEqual(tashkeel._split_marks(KASRA + "ب", HINT_MAP), (["ب"], [""]))
        self.assertEqual(tashkeel._split_marks("", HINT_MAP), ([], []))

    def test_shadda_in_the_other_order_is_accepted(self):
        _, marks = tashkeel._split_marks("م" + SHADDA + FATHA, HINT_MAP)
        self.assertEqual(marks, [FATHA + SHADDA])

    def test_unreadable_characters_are_kept_aside_and_digits_become_a_symbol(self):
        valid, removed = tashkeel._valid_chars("ب A 5 😀", INPUT_MAP)
        self.assertEqual(valid, "ب  # ")
        self.assertEqual(removed, {"A", "😀"})


class TashkeelTests(unittest.TestCase):
    def test_marks_are_added_after_each_letter(self):
        t, _ = make()
        self.assertEqual(t("بسم"), "بِسمَ")

    def test_text_that_is_not_arabic_is_untouched_and_never_sent_to_the_model(self):
        t, session = make()
        self.assertEqual(t("hello world 123"), "hello world 123")
        self.assertEqual(session.fed, [])

    def test_latin_words_inside_arabic_stay_in_place(self):
        t, session = make()
        out = t("بسم OK بسم")
        self.assertEqual(out, "بِسمَ OK بِسمَ")

    def test_digits_keep_their_place(self):
        t, _ = make()
        self.assertEqual(t("بسم 5"), "بِسمَ 5")

    def test_marks_the_writer_already_put_are_replaced_by_the_models(self):
        t, _ = make()
        self.assertEqual(t("بُسم"), "بِسمَ")

    def test_each_sentence_is_a_separate_run(self):
        t, session = make()
        t("بسم. بسم؟ بسم")
        self.assertEqual(len(session.fed), 3)

    def test_model_inputs_are_ids_hints_and_length(self):
        t, session = make()
        t("بِسم")
        feed = session.fed[0]
        self.assertEqual(feed["input_ids"].shape, (1, 3))
        self.assertEqual(feed["diac_ids"].tolist(), [[HINT_MAP[KASRA], 1, 1]])
        self.assertEqual(feed["input_length"].tolist(), [3])

    def test_a_broken_model_answer_falls_back_to_the_plain_text(self):
        t, session = make()
        original_run = session.run
        session.run = lambda o, f: [np.array([[1]], dtype=np.uint8), None]  # one mark for three letters
        self.assertEqual(t("بسم"), "بسم")
        session.run = original_run

    def test_an_exception_falls_back_to_the_plain_text(self):
        t, session = make()

        def boom(*_a):
            raise RuntimeError("no model")

        session.run = boom
        self.assertEqual(t("بسم"), "بسم")

    def test_missing_model_files_give_none(self):
        self.assertIsNone(tashkeel.load("/definitely/not/here"))


if __name__ == "__main__":
    unittest.main()
