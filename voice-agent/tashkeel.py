"""
Adds the short vowel marks (tashkeel) to Arabic text before the voice speaks it.

Why: the Piper Arabic voice was trained on text WITH vowel marks. Everyday Arabic is written without them, so the voice has to guess every vowel
and it sounds like a robot reading letter by letter. Giving it marked text is the single biggest step towards a natural voice.

How: a small free model (libtashkeel by mush42, MIT licence, 4.7 MB) runs on the CPU through onnxruntime, which is already installed for
faster-whisper. This file is a port of its text handling (crates/core/src/lib.rs); the model and its three id maps are downloaded once by
entrypoint.sh into /models/tashkeel.

If anything is missing or fails, the text is spoken as it is: marks are an improvement, never a requirement.
"""
import json
import logging
import os
import re

import numpy as np

log = logging.getLogger("voice-agent")

SHADDA = "ّ"
DIACRITICS = frozenset("ًٌٍَُِّْ")  # sukun shadda fatha damma kasra and the three tanwin
NUMERALS = frozenset("0123456789٠١٢٣٤٥٦٧٨٩")
NUMERAL_SYMBOL = "#"
PAD = "_"
CHAR_LIMIT = 12000
_ARABIC_LETTER = re.compile("[ء-ي]")
_SENTENCE_END = re.compile(r"(?<=[.!?؟؛\n])\s+")


def _valid_chars(text: str, input_map: dict):
    """What the model can read, and the characters it cannot (they are put back untouched afterwards)."""
    valid, removed = [], set()
    for c in text:
        if c in input_map or c in DIACRITICS:
            valid.append(c)
        elif c in NUMERALS:
            valid.append(NUMERAL_SYMBOL)
        else:
            removed.add(c)
    return "".join(valid), removed


def _split_marks(valid: str, hint_map: dict):
    """Letters and, for each letter, the marks the writer already put on it (the model treats them as hints)."""
    text = valid.lstrip("".join(DIACRITICS))
    chars, marks, pending = [], [], ""
    for c in text + " ":  # the trailing space flushes the marks of the last letter
        if c in DIACRITICS:
            pending += c
        else:
            chars.append(c)
            marks.append(pending)
            pending = ""
    chars.pop()
    marks.pop(0)
    for i, m in enumerate(marks):
        if m not in hint_map:
            # the same marks written in the other order (shadda first), else drop them
            swapped = m.replace(SHADDA, "") + SHADDA if SHADDA in m and len(m) == 2 else ""
            marks[i] = swapped if swapped in hint_map else ""
    return chars, marks


def _annotate(text: str, marks: list, removed: set) -> str:
    out, it = [], iter(marks)
    for c in text:
        if c in DIACRITICS:
            continue  # the model's marks replace the writer's
        out.append(c)
        if c not in removed:
            out.append(next(it))
    return "".join(out)


class Tashkeel:
    def __init__(self, session, input_map: dict, hint_map: dict, target_map: dict):
        self.session = session
        self.input_map, self.hint_map = input_map, hint_map
        self.target_marks = {i: m for m, i in target_map.items()}
        self.pad_id = input_map[PAD]
        self.input_names = [i.name for i in session.get_inputs()]

    def _one(self, sentence: str) -> str:
        sentence = sentence.strip()
        if not sentence or len(sentence) > CHAR_LIMIT or not _ARABIC_LETTER.search(sentence):
            return sentence
        valid, removed = _valid_chars(sentence, self.input_map)
        chars, hints = _split_marks(valid, self.hint_map)
        if not chars:
            return sentence
        ids = np.array([[self.input_map[c] for c in chars]], dtype=np.int64)
        hint_ids = np.array([[self.hint_map[h] for h in hints]], dtype=np.int64)
        length = np.array([len(chars)], dtype=np.int64)
        feed = dict(zip(self.input_names, (ids, hint_ids, length)))
        target = self.session.run(None, feed)[0].reshape(-1)
        marks = [self.target_marks[int(t)] for t in target if int(t) != self.pad_id]
        if len(marks) != len(chars):
            raise ValueError(f"the model returned {len(marks)} marks for {len(chars)} letters")
        return _annotate(sentence, marks, removed)

    def __call__(self, text: str) -> str:
        try:
            return " ".join(self._one(s) for s in _SENTENCE_END.split(text) if s.strip())
        except Exception as err:  # the voice speaks the plain text instead
            log.warning("tashkeel skipped: %s", err)
            return text


def load(folder: str):
    """The model from `folder`, or None (and a log line) when it is not there."""
    try:
        import onnxruntime

        with open(os.path.join(folder, "input_id_map.json"), encoding="utf8") as f:
            input_map = json.load(f)
        with open(os.path.join(folder, "hint_id_map.json"), encoding="utf8") as f:
            hint_map = json.load(f)
        with open(os.path.join(folder, "target_id_map.json"), encoding="utf8") as f:
            target_map = json.load(f)
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 1  # a few characters at a time: one thread is plenty and leaves the CPU to the speech models
        session = onnxruntime.InferenceSession(os.path.join(folder, "model.onnx"), options, providers=["CPUExecutionProvider"])
        return Tashkeel(session, input_map, hint_map, target_map)
    except Exception as err:
        log.warning("tashkeel unavailable, the voice will read plain text: %s", err)
        return None
