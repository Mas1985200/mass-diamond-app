# video-worker/tests/test_ltx.py
# Checks the LTX-Video backend without a GPU, with a fake runtime in place of
# torch and diffusers: which pipeline is used, the settings it gets, the frame
# conversion, the out-of-memory error and the stop on a lost lease. Run from the
# video-worker folder:
#   python -m unittest tests.test_ltx

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from worker.models.base import BackendError, SceneJob, TaskCancelled
from worker.models.ltx import (
    NEGATIVE_PROMPT,
    STEPS_BY_QUALITY,
    LtxRuntime,
    LtxVideoBackend,
    to_uint8,
)

W, H = 64, 32


class FakeGpuOutOfMemory(Exception):
    pass


class FakePipeline:
    def __init__(self, frames_made=None, error=None):
        self.calls = []
        self.frames_made = frames_made
        self.error = error

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        steps = kwargs["num_inference_steps"]
        for step in range(steps):
            kwargs["callback_on_step_end"](self, step, 0, {"latents": None})
        count = self.frames_made if self.frames_made is not None else kwargs["num_frames"]
        video = np.random.RandomState(1).rand(count, kwargs["height"], kwargs["width"], 3).astype(np.float32)
        return SimpleNamespace(frames=[video])


class Sink:
    def __init__(self):
        self.frames = []

    def write(self, frame):
        self.frames.append(frame)


def job(**extra):
    base = dict(prompt="a fox", width=W, height=H, frames=25, fps=24, seed=5, quality="standard", start_image=None)
    base.update(extra)
    return SceneJob(**base)


class LtxTests(unittest.TestCase):
    def make(self, text=None, image=None):
        self.text = text or FakePipeline()
        self.image = image or FakePipeline()
        self.cache_emptied = 0
        self.loads = 0
        self.images_loaded = []

        def empty_cache():
            self.cache_emptied += 1

        def loader(model_id, device):
            self.loads += 1
            self.loaded_with = (model_id, device)
            return LtxRuntime(
                text_pipeline=self.text,
                image_pipeline=self.image,
                make_generator=lambda seed: ("generator", seed),
                empty_cache=empty_cache,
                oom_types=(FakeGpuOutOfMemory,),
            )

        def image_loader(path, width, height):
            self.images_loaded.append((path, width, height))
            return "image-object"

        return LtxVideoBackend("model/x", "cuda", loader=loader, image_loader=image_loader)

    def test_text_scene(self):
        backend = self.make()
        sink, steps = Sink(), []
        backend.generate(job(), sink, steps.append)
        self.assertEqual(self.loaded_with, ("model/x", "cuda"))
        self.assertEqual(len(self.text.calls), 1)
        self.assertEqual(len(self.image.calls), 0)
        call = self.text.calls[0]
        self.assertEqual(call["prompt"], "a fox")
        self.assertEqual(call["negative_prompt"], NEGATIVE_PROMPT)
        self.assertEqual((call["width"], call["height"], call["num_frames"], call["frame_rate"]), (W, H, 25, 24))
        self.assertEqual(call["num_inference_steps"], STEPS_BY_QUALITY["standard"])
        self.assertEqual(call["generator"], ("generator", 5))
        self.assertEqual(call["output_type"], "np")
        self.assertNotIn("image", call)
        self.assertEqual(len(sink.frames), 25)
        self.assertEqual(sink.frames[0].shape, (H, W, 3))
        self.assertEqual(sink.frames[0].dtype, np.uint8)
        self.assertEqual(steps[-1], 1.0)
        self.assertEqual(steps, sorted(steps))

    def test_image_scene(self):
        backend = self.make()
        sink = Sink()
        backend.generate(job(start_image=Path("/x/start.png"), quality="high"), sink, lambda f: None)
        self.assertEqual(len(self.image.calls), 1)
        self.assertEqual(len(self.text.calls), 0)
        self.assertEqual(self.image.calls[0]["image"], "image-object")
        self.assertEqual(self.image.calls[0]["num_inference_steps"], STEPS_BY_QUALITY["high"])
        self.assertEqual(self.images_loaded, [(Path("/x/start.png"), W, H)])

    def test_loads_once(self):
        backend = self.make()
        backend.generate(job(), Sink(), lambda f: None)
        backend.generate(job(), Sink(), lambda f: None)
        self.assertEqual(self.loads, 1)
        backend.close()
        self.assertEqual(self.cache_emptied, 1)
        backend.close()
        self.assertEqual(self.cache_emptied, 1)
        backend.generate(job(), Sink(), lambda f: None)
        self.assertEqual(self.loads, 2)

    def test_extra_frames_are_cut_and_missing_frames_fail(self):
        sink = Sink()
        self.make(text=FakePipeline(frames_made=30)).generate(job(), sink, lambda f: None)
        self.assertEqual(len(sink.frames), 25)
        short = self.make(text=FakePipeline(frames_made=20))
        with self.assertRaises(BackendError) as caught:
            short.generate(job(), Sink(), lambda f: None)
        self.assertEqual(caught.exception.code, "bad_output")

    def test_out_of_memory(self):
        backend = self.make(text=FakePipeline(error=FakeGpuOutOfMemory("boom")))
        with self.assertRaises(BackendError) as caught:
            backend.generate(job(), Sink(), lambda f: None)
        self.assertEqual(caught.exception.code, "gpu_out_of_memory")
        self.assertTrue(caught.exception.retryable)
        self.assertEqual(self.cache_emptied, 1)

    def test_other_errors_pass_through(self):
        backend = self.make(text=FakePipeline(error=ValueError("different")))
        with self.assertRaises(ValueError):
            backend.generate(job(), Sink(), lambda f: None)

    def test_cancel_passes_through(self):
        backend = self.make()

        def cancel(fraction):
            if fraction > 0.2:
                raise TaskCancelled()

        sink = Sink()
        with self.assertRaises(TaskCancelled):
            backend.generate(job(), sink, cancel)
        self.assertEqual(len(sink.frames), 0)

    def test_to_uint8(self):
        floats = np.array([[[[0.0, 0.5, 1.0]]], [[[2.0, -1.0, np.nan]]]], dtype=np.float32)
        out = to_uint8(floats)
        self.assertEqual(out.dtype, np.uint8)
        self.assertEqual(out[0, 0, 0].tolist(), [0, 128, 255])
        self.assertEqual(out[1, 0, 0].tolist(), [255, 0, 0])
        raw = np.zeros((1, 2, 2, 3), dtype=np.uint8)
        self.assertIs(to_uint8(raw), raw)
        with self.assertRaises(BackendError):
            to_uint8(np.zeros((2, 2, 3)))


if __name__ == "__main__":
    unittest.main()
