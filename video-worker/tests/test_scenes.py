# video-worker/tests/test_scenes.py
# Checks the scene maker with a fake model (no GPU needed): every scene is made,
# scenes continue from the last frame of the one before, pictures start their own
# scenes, a wrong frame count is caught and a lost lease stops the work at once.
# Skipped where ffmpeg is not installed. Run from the video-worker folder:
#   python -m unittest tests.test_scenes

import shutil
import tempfile
import unittest
from pathlib import Path

from worker.models.base import BackendError, SceneJob, TaskCancelled
from worker.pipeline.media import probe_duration
from worker.pipeline.plan import parse_plan
from worker.pipeline.scenes import make_scenes

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


class FakeBackend:
    name = "fake"

    def __init__(self, frame_delta: int = 0, cancel_after_steps: int | None = None):
        self.jobs: list[SceneJob] = []
        self.start_images_existed: list[bool] = []
        self.frame_delta = frame_delta
        self.cancel_after_steps = cancel_after_steps
        self.steps = 0
        self.closed = False

    def generate(self, job, sink, on_step):
        self.jobs.append(job)
        self.start_images_existed.append(job.start_image is not None and job.start_image.exists())
        frame = bytes([40 * (len(self.jobs) % 5), 90, 140]) * (job.width * job.height)
        total = job.frames + self.frame_delta
        for i in range(total):
            sink.write(frame)
            if i % 8 == 0:
                self.steps += 1
                if self.cancel_after_steps is not None and self.steps > self.cancel_after_steps:
                    raise TaskCancelled()
                on_step(i / total)

    def close(self):
        self.closed = True


def fake_fetch(url: str, dest: Path) -> None:
    dest.write_bytes(b"fake picture for " + url.encode())


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg is not installed")
class SceneTests(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.dir = Path(self._folder.name)

    def tearDown(self):
        self._folder.cleanup()

    def plan(self, **extra):
        return parse_plan({"prompt": "a fox", "duration_seconds": 8, "quality": "draft", "seed": 7, **extra})

    def test_text_to_video_chain(self):
        plan = self.plan()
        self.assertEqual([s.seconds for s in plan.scenes], [4, 4])
        backend = FakeBackend()
        progress: list[float] = []
        files = make_scenes(plan, backend, self.dir, fake_fetch, progress.append)
        self.assertEqual(len(files), 2)
        for f, s in zip(files, plan.scenes):
            self.assertAlmostEqual(probe_duration(f), s.seconds, delta=0.2)
        self.assertIsNone(backend.jobs[0].start_image)
        self.assertEqual(backend.jobs[1].start_image, self.dir / "last_000.png")
        self.assertEqual(backend.start_images_existed, [False, True])
        self.assertEqual([j.seed for j in backend.jobs], [7, 8])
        self.assertEqual(progress[0], 0.0)
        self.assertEqual(progress[-1], 1.0)
        self.assertEqual(progress, sorted(progress))

    def test_image_scenes(self):
        urls = ["https://a/1.png", "https://a/2.png"]
        plan = self.plan(kind="multi_image_to_video", image_urls=urls, duration_seconds=4)
        backend = FakeBackend()
        make_scenes(plan, backend, self.dir, fake_fetch, lambda f: None)
        self.assertEqual(len(backend.jobs), 2)
        self.assertEqual(backend.jobs[0].start_image, self.dir / "source_000.img")
        self.assertEqual(backend.jobs[1].start_image, self.dir / "source_001.img")
        self.assertIn(b"2.png", (self.dir / "source_001.img").read_bytes())

    def test_wrong_frame_count(self):
        for delta in (-1, 1):
            with self.assertRaises(BackendError) as caught:
                make_scenes(self.plan(duration_seconds=2), FakeBackend(frame_delta=delta), self.dir, fake_fetch, lambda f: None)
            self.assertEqual(caught.exception.code, "bad_output")
            self.assertTrue(caught.exception.retryable)

    def test_cancel_stops_and_cleans(self):
        backend = FakeBackend(cancel_after_steps=2)
        with self.assertRaises(TaskCancelled):
            make_scenes(self.plan(), backend, self.dir, fake_fetch, lambda f: None)
        self.assertEqual(len(backend.jobs), 1)


if __name__ == "__main__":
    unittest.main()
