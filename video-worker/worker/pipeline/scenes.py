# video-worker/worker/pipeline/scenes.py
# Makes every scene of a plan with a video model and writes it to its own file.
# A scene that has no picture of its own starts from the last frame of the scene
# before it, so even a 10-minute video flows as one continuous shot. Only the
# interface of the model is used (models/base.py), so this step is tested with a
# fake model and needs no GPU.

from __future__ import annotations

import random
from pathlib import Path
from typing import Callable

from ..models.base import BackendError, FrameSink, SceneJob, VideoBackend
from .media import MediaError, VideoWriter, extract_last_frame, probe_duration
from .plan import VideoPlan

# Saves one picture from a link into a file (injected: the real one downloads).
ImageFetcher = Callable[[str, Path], None]
# Receives the fraction of all scenes done, from 0 to 1.
ProgressCallback = Callable[[float], None]

_LENGTH_TOLERANCE_SECONDS = 0.35


class _CountingSink:
    """Passes frames on to the writer and counts them, so a model that makes too
    few or too many frames is caught instead of producing a broken video."""

    def __init__(self, writer: VideoWriter) -> None:
        self._writer = writer
        self.count = 0

    def write(self, frame: object) -> None:
        self._writer.write(frame)
        self.count += 1


def scene_file(work_dir: Path, index: int) -> Path:
    return work_dir / f"scene_{index:03d}.mp4"


def make_scenes(
    plan: VideoPlan,
    backend: VideoBackend,
    work_dir: Path,
    fetch_image: ImageFetcher,
    on_progress: ProgressCallback,
) -> list[Path]:
    """Makes all scenes and returns their files in order."""
    work_dir.mkdir(parents=True, exist_ok=True)
    base_seed = plan.seed if plan.seed is not None else random.SystemRandom().randrange(2**31)
    total = len(plan.scenes)
    files: list[Path] = []
    previous_last_frame: Path | None = None

    on_progress(0.0)
    for scene in plan.scenes:
        if scene.image_index is not None:
            start_image: Path | None = work_dir / f"source_{scene.index:03d}.img"
            fetch_image(plan.image_urls[scene.image_index], start_image)
        else:
            start_image = previous_last_frame

        job = SceneJob(
            prompt=scene.prompt,
            width=plan.width,
            height=plan.height,
            frames=scene.frames,
            fps=plan.fps,
            seed=(base_seed + scene.index) % (2**31),
            quality=plan.quality,
            start_image=start_image,
        )
        out = scene_file(work_dir, scene.index)

        def on_step(fraction: float, _index: int = scene.index) -> None:
            clamped = max(0.0, min(1.0, fraction))
            on_progress((_index + clamped) / total)

        with VideoWriter(out, plan.width, plan.height, plan.fps) as writer:
            sink = _CountingSink(writer)
            backend.generate(job, sink, on_step)
            made = sink.count
        if made != scene.frames:
            raise BackendError(
                "bad_output",
                f"Scene {scene.index + 1} has {made} frames, expected {scene.frames}.",
                True,
            )

        expected = scene.frames / plan.fps
        if abs(probe_duration(out) - expected) > _LENGTH_TOLERANCE_SECONDS:
            raise MediaError(f"Scene {scene.index + 1} has the wrong length.")

        if scene.index < total - 1:
            last = work_dir / f"last_{scene.index:03d}.png"
            extract_last_frame(out, last)
            previous_last_frame = last
        files.append(out)
        on_progress((scene.index + 1) / total)

    return files
