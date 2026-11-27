"""Run as a process of its own: python stt_probe.py <model> <compute type>   (stt_device.run_probe)

Loads the model on the graphics card and REALLY runs it once: CTranslate2 loads cuBLAS and cuDNN only when it first computes, and a missing cuDNN
aborts the whole process instead of raising. Exit code 0: this model works on this card. The first run downloads the model into HF_HOME.
"""
import sys


def main(model: str, compute: str) -> None:
    import numpy as np
    from faster_whisper import WhisperModel

    recogniser = WhisperModel(model, device="cuda", compute_type=compute)
    noise = (np.random.default_rng(0).standard_normal(16000) * 0.01).astype(np.float32)
    # the widest beam the agent uses (a voice note), so the card's memory is tried at its worst
    segments, _ = recogniser.transcribe(noise, language="ar", beam_size=5, temperature=0.0, vad_filter=False, condition_on_previous_text=False)
    list(segments)  # the work happens as the pieces are read


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as err:  # the parent reads these last words to say why
        print(f"{type(err).__name__}: {err}", file=sys.stderr)
        sys.exit(1)
