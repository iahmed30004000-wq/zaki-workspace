"""Which device listens: the graphics card or the processor. Standard library only: the model, the card and the processes are handed in, so all of it is
tested without any of them (test_stt_device.py).

    STT_DEVICE=auto (default)  the card when CTranslate2 counts one AND the model really loads and runs there, else the processor
    STT_DEVICE=cpu             the processor, always
    STT_DEVICE=cuda            try the card even when none is counted; a failure still ends on the processor

The agent NEVER fails to start because of the card. A missing cuDNN does not raise in Python: the C++ library ABORTS the process. So every model is
first tried in a process of its own (stt_probe.py), and only a model that survived there is loaded here.
"""
import ctypes
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SETTINGS = ("auto", "cpu", "cuda")
# the accurate model, with 8-bit weights: about a third less card memory than float16 for nearly the same words. The card's size is unknown and a
# local language model may be sharing it.
GPU_DEFAULT_MODEL = "large-v3"
GPU_DEFAULT_COMPUTE = "int8_float16"
# the smaller models tried, in this order, when the card cannot hold the one asked for (names faster-whisper 1.0.3 knows)
GPU_SMALLER = ("medium", "small")
_SIZE = {"tiny": 0, "base": 1, "small": 2, "medium": 3}
# the version of the signed transcription door (notes.py); /health says it, so the site can tell an agent that is too old
DOOR_VERSION = 1


def parse_setting(raw) -> tuple[str, bool]:
    """STT_DEVICE as one of SETTINGS, and whether the text was understood (anything else is «auto»)."""
    value = (raw or "").strip().lower()
    if value == "":
        return "auto", True
    if value == "gpu":
        return "cuda", True
    return (value, True) if value in SETTINGS else ("auto", False)


def gpu_ladder(model: str, compute: str) -> list[tuple[str, str]]:
    """The model asked for, then only SMALLER ones. A name this list does not know is taken to be a big one."""
    size = _SIZE.get(model.split(".")[0], max(_SIZE.values()) + 1)
    return [(model, compute)] + [(smaller, compute) for smaller in GPU_SMALLER if _SIZE[smaller] < size]


def classify_failure(detail: str) -> str:
    """Why the card could not be used, from the last words of the attempt. The order matters: a memory failure of cuBLAS carries its name too."""
    text = (detail or "").lower()
    if "out of memory" in text or "alloc_failed" in text or "failed to allocate" in text:
        return "gpu_memory"
    if "compute type, but" in text:
        return "gpu_compute"
    if "driver version is insufficient" in text or "no cuda-capable device" in text or "forward compatibility" in text:
        return "gpu_driver"
    if "libcublas" in text or "libcudnn" in text or "cannot load symbol cudnn" in text or "cannot open shared object" in text or "cannot be loaded" in text:
        return "gpu_libs"
    return "gpu_failed"


# a smaller model does not help against these
_HOPELESS = ("gpu_libs", "gpu_driver")


@dataclass
class Choice:
    """What is listening now. `recogniser` is the loaded model; it never travels anywhere."""

    device: str  # "cpu" | "cuda"
    model: str
    compute: str
    setting: str
    requested: str  # the model the card was asked for
    gpu_found: bool = False
    gpu: dict | None = None  # {"name", "memoryMb"} from the driver's own tool, when it is there
    reason: str = ""  # "" | forced_cpu | no_gpu | gpu_driver | gpu_libs | gpu_memory | gpu_compute | gpu_failed | gpu_runtime
    recogniser: object = None

    @property
    def fallback(self) -> bool:
        """The card runs a smaller model than the one asked for."""
        return self.device == "cuda" and self.model != self.requested


def _quietly(fn, otherwise):
    try:
        return fn()
    except Exception:
        return otherwise


def choose(setting, *, cpu_model, gpu_model, gpu_compute, gpu_count, gpu_card, libs_ok, probe, load_gpu, load_cpu, warn) -> Choice:
    """The recogniser to listen with. Only loading on the PROCESSOR may raise (as it always could): nothing about the card ever does.

    gpu_count()            how many cards CTranslate2 can use
    gpu_card()             {"name", "memoryMb"} or None
    libs_ok()              the CUDA libraries are there (asked before anything is downloaded)
    probe(model, compute)  (ok, detail): the model tried in a process of its own
    load_gpu / load_cpu    the real loading, here
    """
    count = _quietly(gpu_count, 0) or 0
    card = _quietly(gpu_card, None)
    found = count > 0 or card is not None

    def processor(reason: str) -> Choice:
        recogniser = load_cpu(cpu_model)
        return Choice("cpu", cpu_model, "int8", setting, gpu_model, found, card, reason, recogniser)

    if setting == "cpu":
        return processor("forced_cpu")
    if setting == "auto" and count <= 0:
        if card is None:
            return processor("no_gpu")
        warn("a graphics card is there but CTranslate2 cannot use it (the driver?): listening on the processor")
        return processor("gpu_driver")
    if not _quietly(libs_ok, False):
        reason = "gpu_libs" if found else "no_gpu"
        warn("the CUDA libraries are not in this build (docker-compose.gpu.yml installs them): listening on the processor")
        return processor(reason)

    attempts = gpu_ladder(gpu_model, gpu_compute)
    reason = ""
    at = 0
    while at < len(attempts):
        model, compute = attempts[at]
        ok, detail = probe(model, compute)
        if ok:
            try:
                recogniser = load_gpu(model, compute)
            except Exception as err:
                detail = str(err)
            else:
                return Choice("cuda", model, compute, setting, gpu_model, True, card, reason, recogniser)
        reason = classify_failure(detail)
        warn(f"the graphics card could not run {model} ({compute}): {reason}: {(detail or '').strip()[-400:]}")
        if reason in _HOPELESS:
            break
        if reason == "gpu_compute" and compute != "int8":
            # a card without efficient half precision: the same model, and the ones after it, with plain 8-bit
            attempts = attempts[:at] + [(name, "int8") for name, _ in attempts[at:]]
            continue
        at += 1
    warn("listening on the processor")
    return processor(reason or "gpu_failed")


def run_probe(model: str, compute: str, *, run=subprocess.run, script: str | None = None, python: str | None = None, timeout: float = 1800) -> tuple[bool, str]:
    """Try the model on the card in a process of its own. The first try downloads the model, so the wait is long. Never raises."""
    args = [python or sys.executable, script or str(Path(__file__).with_name("stt_probe.py")), model, compute]
    try:
        done = run(args, capture_output=True, text=True, errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"the try did not finish in {int(timeout)} seconds"
    except Exception as err:
        return False, f"the try could not start: {err}"
    if done.returncode == 0:
        return True, ""
    return False, (done.stderr or "")[-2000:] or f"the try ended with code {done.returncode}"


def gpu_card(run=subprocess.run) -> dict | None:
    """The first card's name and memory from nvidia-smi, which the NVIDIA container toolkit puts in the container (capability «utility»). None: unknown."""
    try:
        done = run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, errors="replace", timeout=10)
    except Exception:
        return None
    line = (done.stdout or "").strip().splitlines()[0:1]
    if done.returncode != 0 or not line:
        return None
    name, _, memory = line[0].rpartition(",")
    if not name.strip():
        return None
    return {"name": name.strip()[:80], "memoryMb": int(memory) if memory.strip().isdigit() else None}


def cublas_present(load=ctypes.CDLL) -> bool:
    """cuBLAS is needed by every CTranslate2 build on a card. Asked first, so a build without the libraries downloads nothing."""
    try:
        load("libcublas.so.12")
        return True
    except OSError:
        return False


def health_stt(choice: Choice | None, *, hosted_meetings: bool) -> dict:
    """The «stt» part of /health: no secret, no path, nothing anybody said."""
    meetings = "hosted" if hosted_meetings else "local"
    if choice is None:
        return {"door": DOOR_VERSION, "ready": False, "meetings": meetings}
    return {
        "door": DOOR_VERSION,
        "ready": True,
        "device": choice.device,
        "gpuFound": choice.gpu_found,
        "gpu": choice.gpu,
        "model": choice.model,
        "compute": choice.compute,
        "requested": choice.requested,
        "setting": choice.setting,
        "reason": choice.reason,
        "fallback": choice.fallback,
        "meetings": meetings,
    }


class RuntimeGuard:
    """A card that loaded can still stop working (another program takes its memory). After `limit` failures in a row the agent moves to the processor,
    so a meeting never stays deaf. Asks once."""

    def __init__(self, limit: int = 3) -> None:
        self.limit, self.row, self.asked = limit, 0, False

    def worked(self) -> None:
        self.row = 0

    def failed(self) -> bool:
        self.row += 1
        if self.asked or self.row < self.limit:
            return False
        self.asked = True
        return True
