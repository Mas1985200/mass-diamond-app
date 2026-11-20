# video-worker/tests/test_media.py
# Checks the ffmpeg tools with real (tiny) videos. Skipped where ffmpeg is not
# installed. Run from the video-worker folder:
#   python -m unittest tests.test_media

import shutil
import tempfile
import unittest
from pathlib import Path

from worker.pipeline.media import (
    MediaError,
    VideoWriter,
    concat_videos,
    extract_last_frame,
    probe_duration,
)

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
W, H, FPS = 64, 64, 24


def solid(r: int, g: int, b: int) -> bytes:
    return bytes([r, g, b]) * (W * H)


def make_scene(path: Path, frames: int, color: tuple[int, int, int]) -> None:
    with VideoWriter(path, W, H, FPS) as writer:
        for _ in range(frames):
            writer.write(solid(*color))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg is not installed")
class MediaTests(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.dir = Path(self._folder.name)

    def tearDown(self):
        self._folder.cleanup()

    def test_write_and_probe(self):
        scene = self.dir / "a.mp4"
        make_scene(scene, 48, (200, 30, 30))
        self.assertAlmostEqual(probe_duration(scene), 2.0, delta=0.1)

    def test_last_frame(self):
        scene = self.dir / "a.mp4"
        make_scene(scene, 48, (30, 200, 30))
        png = self.dir / "last.png"
        extract_last_frame(scene, png)
        self.assertGreater(png.stat().st_size, 0)
        self.assertEqual(png.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_concat(self):
        a, b, c = self.dir / "a.mp4", self.dir / "b.mp4", self.dir / "it's c.mp4"
        make_scene(a, 24, (255, 0, 0))
        make_scene(b, 48, (0, 255, 0))
        make_scene(c, 24, (0, 0, 255))
        out = self.dir / "all.mp4"
        concat_videos([a, b, c], out)
        self.assertAlmostEqual(probe_duration(out), 4.0, delta=0.15)
        single = self.dir / "one.mp4"
        concat_videos([a], single)
        self.assertAlmostEqual(probe_duration(single), 1.0, delta=0.1)

    def test_errors(self):
        with self.assertRaises(MediaError):
            probe_duration(self.dir / "missing.mp4")
        with self.assertRaises(MediaError):
            concat_videos([], self.dir / "x.mp4")
        with self.assertRaises(MediaError):
            VideoWriter(self.dir / "x.mp4", 63, 64, FPS)
        with self.assertRaises(MediaError):
            extract_last_frame(self.dir / "missing.mp4", self.dir / "x.png")

    def test_wrong_frame_size_aborts_cleanly(self):
        out = self.dir / "bad.mp4"
        with self.assertRaises(MediaError):
            with VideoWriter(out, W, H, FPS) as writer:
                writer.write(b"too short")

    def test_numpy_frames(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy is not installed")
        out = self.dir / "np.mp4"
        with VideoWriter(out, W, H, FPS) as writer:
            for i in range(24):
                writer.write(np.full((H, W, 3), i * 10, dtype=np.uint8))
        self.assertAlmostEqual(probe_duration(out), 1.0, delta=0.1)


if __name__ == "__main__":
    unittest.main()
