# video-worker/worker/models/base.py
# What the worker needs from a video model, and nothing more. The scene maker
# only knows this contract, so the model (LTX-Video today, a bigger one on a
# bigger GPU tomorrow) can be replaced without touching the plan, the joining or
# the queue. No model, no GPU and no heavy library is imported here.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


class TaskCancelled(Exception):
    """The task is no longer ours (the lease was lost): stop at once. Raised from
    the progress callback; a backend must let it pass."""

    code = "cancelled"


class BackendError(Exception):
    """The model could not make the scene. `retryable` is True when another
    machine or another try may succeed (for example a GPU out of memory)."""

    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class SceneJob:
    prompt: str
    width: int
    height: int
    frames: int  # always 8k + 1
    fps: int
    seed: int
    quality: str  # draft | standard | high
    # The picture this scene must start from (a user picture, or the last frame
    # of the scene before it). None: make the scene from the words alone.
    start_image: Path | None


class FrameSink(Protocol):
    def write(self, frame: object) -> None:
        """Takes one frame: a uint8 array of shape (height, width, 3) or its bytes."""


class VideoBackend(Protocol):
    name: str

    def generate(
        self,
        job: SceneJob,
        sink: FrameSink,
        on_step: Callable[[float], None],
    ) -> None:
        """Makes `job.frames` frames and writes them to `sink` in order.

        `on_step` is called with the fraction done (0 to 1) as the model works;
        it may raise TaskCancelled, which must not be caught.
        """

    def close(self) -> None:
        """Frees the GPU."""
