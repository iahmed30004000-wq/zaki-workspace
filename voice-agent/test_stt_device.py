"""Which device listens (stt_device.py): no GPU, no model and no network are needed here, everything is injected."""
import json
import subprocess
import unittest

import stt_device

CARD = {"name": "NVIDIA GeForce RTX 3060", "memoryMb": 12288}

# real messages of CTranslate2 / CUDA, as the probe's last words
NO_CUBLAS = "RuntimeError: Library libcublas.so.12 is not found or cannot be loaded"
NO_CUDNN = "Unable to load any of {libcudnn_ops.so.9.1.0, libcudnn_ops.so.9.1}\nInvalid handle. Cannot load symbol cudnnCreateTensorDescriptor"
OOM = "RuntimeError: CUDA failed with error out of memory"
ALLOC = "RuntimeError: cuBLAS failed with status CUBLAS_STATUS_ALLOC_FAILED"
BAD_TYPE = "ValueError: Requested int8_float16 compute type, but the target device or backend do not support efficient int8_float16 computation."
OLD_DRIVER = "RuntimeError: CUDA failed with error CUDA driver version is insufficient for CUDA runtime version"


class Fake:
    """The injected world of `choose`: which (model, compute) pairs probe well, and what was asked."""

    def __init__(self, fails=None, count=1, card=CARD, libs=True, load_fails=None):
        self.fails = fails or {}
        self.count, self.card, self.libs = count, card, libs
        self.load_fails = load_fails or {}
        self.probed, self.loaded, self.logs = [], [], []

    def probe(self, model, compute):
        self.probed.append((model, compute))
        detail = self.fails.get((model, compute), self.fails.get(model))
        return (False, detail) if detail else (True, "")

    def load_gpu(self, model, compute):
        if model in self.load_fails:
            raise RuntimeError(self.load_fails[model])
        self.loaded.append(("cuda", model, compute))
        return f"gpu:{model}"

    def load_cpu(self, model):
        self.loaded.append(("cpu", model, "int8"))
        return f"cpu:{model}"

    def gpu_count(self):
        if isinstance(self.count, Exception):
            raise self.count
        return self.count

    def choose(self, setting="auto", cpu_model="small", gpu_model="large-v3", gpu_compute="int8_float16"):
        return stt_device.choose(
            setting,
            cpu_model=cpu_model,
            gpu_model=gpu_model,
            gpu_compute=gpu_compute,
            gpu_count=self.gpu_count,
            gpu_card=lambda: self.card,
            libs_ok=lambda: self.libs,
            probe=self.probe,
            load_gpu=self.load_gpu,
            load_cpu=self.load_cpu,
            warn=self.logs.append,
        )


class SettingTests(unittest.TestCase):
    def test_the_three_settings_and_nonsense_is_auto(self):
        self.assertEqual(stt_device.parse_setting("cpu"), ("cpu", True))
        self.assertEqual(stt_device.parse_setting(" CUDA "), ("cuda", True))
        self.assertEqual(stt_device.parse_setting("gpu"), ("cuda", True))
        self.assertEqual(stt_device.parse_setting(""), ("auto", True))
        self.assertEqual(stt_device.parse_setting(None), ("auto", True))
        self.assertEqual(stt_device.parse_setting("vulkan"), ("auto", False))

    def test_the_gpu_ladder_goes_only_down(self):
        self.assertEqual(stt_device.gpu_ladder("large-v3", "int8_float16"), [("large-v3", "int8_float16"), ("medium", "int8_float16"), ("small", "int8_float16")])
        self.assertEqual(stt_device.gpu_ladder("medium", "float16"), [("medium", "float16"), ("small", "float16")])
        self.assertEqual(stt_device.gpu_ladder("small", "int8"), [("small", "int8")])
        self.assertEqual(stt_device.gpu_ladder("some/own-model", "float16"), [("some/own-model", "float16"), ("medium", "float16"), ("small", "float16")])

    def test_the_defaults_are_the_accurate_model_with_the_lighter_memory(self):
        self.assertEqual((stt_device.GPU_DEFAULT_MODEL, stt_device.GPU_DEFAULT_COMPUTE), ("large-v3", "int8_float16"))


class ClassifyTests(unittest.TestCase):
    def test_the_failures_are_told_apart(self):
        for detail, kind in (
            (NO_CUBLAS, "gpu_libs"),
            (NO_CUDNN, "gpu_libs"),
            (OOM, "gpu_memory"),
            (ALLOC, "gpu_memory"),  # «cublas» is in its name, but it is memory
            (BAD_TYPE, "gpu_compute"),
            (OLD_DRIVER, "gpu_driver"),
            ("RuntimeError: something else", "gpu_failed"),
            ("", "gpu_failed"),
        ):
            self.assertEqual(stt_device.classify_failure(detail), kind, detail)


class ChooseTests(unittest.TestCase):
    def test_forced_cpu_never_touches_the_card(self):
        world = Fake()
        got = world.choose("cpu")
        self.assertEqual((got.device, got.model, got.compute, got.reason), ("cpu", "small", "int8", "forced_cpu"))
        self.assertEqual(got.recogniser, "cpu:small")
        self.assertTrue(got.gpu_found)
        self.assertEqual(world.probed, [])

    def test_a_server_without_a_card_is_exactly_the_old_cpu_recogniser(self):
        world = Fake(count=0, card=None)
        got = world.choose(cpu_model="base")
        self.assertEqual((got.device, got.model, got.compute, got.reason, got.gpu_found), ("cpu", "base", "int8", "no_gpu", False))
        self.assertFalse(got.fallback)
        self.assertEqual(world.probed, [])
        self.assertEqual(world.loaded, [("cpu", "base", "int8")])

    def test_a_card_the_driver_cannot_reach(self):
        got = Fake(count=0).choose()
        self.assertEqual((got.device, got.reason, got.gpu_found), ("cpu", "gpu_driver", True))

    def test_counting_the_cards_may_blow_up_and_the_agent_still_starts(self):
        got = Fake(count=OSError("libcuda.so missing"), card=None).choose()
        self.assertEqual((got.device, got.reason), ("cpu", "no_gpu"))

    def test_missing_libraries_are_seen_before_anything_is_downloaded(self):
        world = Fake(libs=False)
        got = world.choose()
        self.assertEqual((got.device, got.reason, got.gpu_found), ("cpu", "gpu_libs", True))
        self.assertEqual(world.probed, [])  # the probe is what downloads gigabytes
        self.assertTrue(world.logs)

    def test_a_good_card_gets_the_accurate_model(self):
        world = Fake()
        got = world.choose()
        self.assertEqual((got.device, got.model, got.compute, got.reason, got.fallback), ("cuda", "large-v3", "int8_float16", "", False))
        self.assertEqual(got.recogniser, "gpu:large-v3")
        self.assertEqual(world.loaded, [("cuda", "large-v3", "int8_float16")])

    def test_a_small_card_falls_back_to_a_smaller_model_and_says_which(self):
        world = Fake(fails={"large-v3": OOM})
        got = world.choose()
        self.assertEqual((got.device, got.model, got.reason, got.fallback, got.requested), ("cuda", "medium", "gpu_memory", True, "large-v3"))
        self.assertTrue(any("large-v3" in line for line in world.logs))

    def test_a_load_that_fails_after_a_good_probe_also_goes_down_the_ladder(self):
        got = Fake(load_fails={"large-v3": "CUDA failed with error out of memory"}).choose()
        self.assertEqual((got.device, got.model, got.reason), ("cuda", "medium", "gpu_memory"))

    def test_a_card_without_efficient_half_precision_keeps_the_model_with_int8(self):
        world = Fake(fails={("large-v3", "int8_float16"): BAD_TYPE})
        got = world.choose()
        self.assertEqual((got.device, got.model, got.compute), ("cuda", "large-v3", "int8"))
        self.assertEqual(world.probed, [("large-v3", "int8_float16"), ("large-v3", "int8")])

    def test_missing_libraries_found_by_the_probe_stop_the_ladder(self):
        world = Fake(fails={"large-v3": NO_CUDNN})
        got = world.choose()
        self.assertEqual((got.device, got.reason), ("cpu", "gpu_libs"))
        self.assertEqual(len(world.probed), 1)

    def test_when_nothing_loads_on_the_card_the_processor_listens(self):
        world = Fake(fails={"large-v3": OOM, "medium": OOM, "small": OOM})
        got = world.choose()
        self.assertEqual((got.device, got.model, got.compute, got.reason, got.gpu_found), ("cpu", "small", "int8", "gpu_memory", True))
        self.assertEqual([m for m, _ in world.probed], ["large-v3", "medium", "small"])

    def test_cuda_asked_for_by_name_probes_even_when_no_card_is_counted_and_still_never_crashes(self):
        world = Fake(count=0, card=None, fails={"large-v3": "RuntimeError: no CUDA-capable device is detected"})
        got = world.choose("cuda")
        self.assertEqual((got.device, got.reason, got.setting), ("cpu", "gpu_driver", "cuda"))
        self.assertEqual(len(world.probed), 1)


class ProbeTests(unittest.TestCase):
    def test_a_clean_exit_is_a_working_card(self):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, "", "")

        self.assertEqual(stt_device.run_probe("large-v3", "float16", run=run, script="/app/stt_probe.py", python="python", timeout=5), (True, ""))
        self.assertEqual(calls[0][0], ["python", "/app/stt_probe.py", "large-v3", "float16"])
        self.assertEqual(calls[0][1]["timeout"], 5)

    def test_a_child_that_aborts_like_a_missing_cudnn_does_is_a_failure_not_a_crash(self):
        def run(args, **kwargs):
            return subprocess.CompletedProcess(args, -6, "", "noise\n" * 500 + NO_CUDNN)

        ok, detail = stt_device.run_probe("large-v3", "float16", run=run, script="p", python="python", timeout=5)
        self.assertFalse(ok)
        self.assertEqual(stt_device.classify_failure(detail), "gpu_libs")
        self.assertLess(len(detail), 2500)

    def test_a_hung_or_unstartable_child_is_a_failure(self):
        def slow(args, **kwargs):
            raise subprocess.TimeoutExpired(args, 5)

        def broken(args, **kwargs):
            raise OSError("no such file")

        for run in (slow, broken):
            ok, detail = stt_device.run_probe("small", "int8", run=run, script="p", python="python", timeout=5)
            self.assertFalse(ok)
            self.assertTrue(detail)


class CardTests(unittest.TestCase):
    def runner(self, code, out):
        def run(args, **kwargs):
            self.assertEqual(args[0], "nvidia-smi")
            return subprocess.CompletedProcess(args, code, out, "")

        return run

    def test_name_and_memory_from_the_drivers_own_tool(self):
        self.assertEqual(stt_device.gpu_card(self.runner(0, "NVIDIA GeForce RTX 3060, 12288\n")), CARD)

    def test_no_tool_or_a_strange_answer_is_simply_unknown(self):
        def missing(args, **kwargs):
            raise FileNotFoundError("nvidia-smi")

        self.assertIsNone(stt_device.gpu_card(missing))
        self.assertIsNone(stt_device.gpu_card(self.runner(9, "NVIDIA-SMI has failed")))
        self.assertIsNone(stt_device.gpu_card(self.runner(0, "")))
        self.assertEqual(stt_device.gpu_card(self.runner(0, "Tesla T4, [N/A]\n")), {"name": "Tesla T4", "memoryMb": None})


class HealthTests(unittest.TestCase):
    def test_health_says_the_device_the_card_and_the_model_in_use(self):
        got = Fake(fails={"large-v3": OOM}).choose()
        body = stt_device.health_stt(got, hosted_meetings=False)
        self.assertEqual(
            body,
            {
                "door": 1,
                "ready": True,
                "device": "cuda",
                "gpuFound": True,
                "gpu": CARD,
                "model": "medium",
                "compute": "int8_float16",
                "requested": "large-v3",
                "setting": "auto",
                "reason": "gpu_memory",
                "fallback": True,
                "meetings": "local",
            },
        )
        json.dumps(body)  # nothing of the loaded model travels

    def test_while_loading_it_says_so_and_still_has_the_door(self):
        self.assertEqual(stt_device.health_stt(None, hosted_meetings=True), {"door": 1, "ready": False, "meetings": "hosted"})


class RuntimeGuardTests(unittest.TestCase):
    def test_three_failures_in_a_row_on_the_card_ask_for_the_processor_once(self):
        guard = stt_device.RuntimeGuard(limit=3)
        self.assertFalse(guard.failed())
        self.assertFalse(guard.failed())
        guard.worked()
        self.assertFalse(guard.failed())
        self.assertFalse(guard.failed())
        self.assertTrue(guard.failed())
        self.assertFalse(guard.failed())  # asked once: the switch is already on its way


if __name__ == "__main__":
    unittest.main()
