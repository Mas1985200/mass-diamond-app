# video-worker/worker/pipeline/media.py
# The ffmpeg tools of the worker: write generated frames into a video file, read
# a video's length, take the last picture of a scene (the next scene starts from
# it, so a long video flows without a cut) and join scenes. Every call uses an
# argument list, never a shell, so a prompt or a file name can not run commands.

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from types import TracebackType
from typing import Sequence

_TAIL_CHARS = 400


class MediaError(Exception):
    """ffmpeg or ffprobe failed. Retrying on another machine may help."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = "media_error"


def _tail(text: bytes | str) -> str:
    value = text.decode("utf-8", "replace") if isinstance(text, bytes) else text
    return value.strip()[-_TAIL_CHARS:]


def run_ffmpeg(args: Sequence[str], timeout: float = 900) -> None:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args]
    try:
        done = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as error:
        raise MediaError("ffmpeg is not installed on this machine.") from error
    except subprocess.TimeoutExpired as error:
        raise MediaError("ffmpeg took too long.") from error
    if done.returncode != 0:
        raise MediaError(f"ffmpeg failed: {_tail(done.stderr)}")


def probe_duration(path: Path) -> float:
    """Length of a media file in seconds."""
    command = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    try:
        done = subprocess.run(command, capture_output=True, timeout=60, check=False)
    except FileNotFoundError as error:
        raise MediaError("ffprobe is not installed on this machine.") from error
    except subprocess.TimeoutExpired as error:
        raise MediaError("ffprobe took too long.") from error
    if done.returncode != 0:
        raise MediaError(f"ffprobe failed: {_tail(done.stderr)}")
    try:
        seconds = float(done.stdout.decode().strip())
    except ValueError as error:
        raise MediaError("The file has no readable length.") from error
    if not seconds > 0:
        raise MediaError("The file has no length.")
    return seconds


def extract_last_frame(video: Path, out_png: Path) -> None:
    """Saves the final picture of a video; the next scene continues from it."""
    run_ffmpeg(
        ["-sseof", "-0.3", "-i", str(video), "-update", "1", "-q:v", "1", str(out_png)],
        timeout=120,
    )
    if not out_png.exists() or out_png.stat().st_size == 0:
        raise MediaError("The last picture of the scene could not be saved.")


def concat_videos(parts: Sequence[Path], out: Path) -> None:
    """Joins scenes that were all written by VideoWriter (same size, speed and
    codec), so no re-encoding is needed and nothing is lost."""
    if not parts:
        raise MediaError("There are no scenes to join.")
    if len(parts) == 1:
        run_ffmpeg(["-i", str(parts[0]), "-c", "copy", "-movflags", "+faststart", str(out)])
        return
    with tempfile.TemporaryDirectory() as folder:
        listing = Path(folder) / "parts.txt"
        lines = []
        for part in parts:
            safe = str(Path(part).resolve()).replace("'", "'\\''")
            lines.append(f"file '{safe}'")
        listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
        run_ffmpeg(
            ["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
             "-movflags", "+faststart", str(out)]
        )


class VideoWriter:
    """Writes raw RGB frames into an H.264 file as they are made, so a scene is
    never held in memory twice."""

    def __init__(self, out: Path, width: int, height: int, fps: int, crf: int = 18) -> None:
        if width <= 0 or height <= 0 or width % 2 or height % 2:
            raise MediaError("The frame size must be even.")
        self._frame_bytes = width * height * 3
        self._errors = tempfile.TemporaryFile()
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
            "-r", str(fps), "-i", "-",
            "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
            "-pix_fmt", "yuv420p", "-r", str(fps), "-movflags", "+faststart", str(out),
        ]
        try:
            self._process = subprocess.Popen(
                command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self._errors
            )
        except FileNotFoundError as error:
            self._errors.close()
            raise MediaError("ffmpeg is not installed on this machine.") from error
        self._closed = False

    def write(self, frame: object) -> None:
        data = frame if isinstance(frame, (bytes, bytearray, memoryview)) else frame.tobytes()  # type: ignore[attr-defined]
        if len(data) != self._frame_bytes:
            raise MediaError("A frame has the wrong size.")
        assert self._process.stdin is not None
        try:
            self._process.stdin.write(data)
        except (BrokenPipeError, OSError) as error:
            raise MediaError(f"ffmpeg stopped: {self._read_errors()}") from error

    def _read_errors(self) -> str:
        self._errors.seek(0)
        return _tail(self._errors.read())

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        assert self._process.stdin is not None
        try:
            self._process.stdin.close()
        except OSError:
            pass
        code = self._process.wait()
        message = self._read_errors()
        self._errors.close()
        if code != 0:
            raise MediaError(f"ffmpeg failed: {message}")

    def abort(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._process.kill()
        self._process.wait()
        self._errors.close()

    def __enter__(self) -> "VideoWriter":
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        if kind is None:
            self.close()
        else:
            self.abort()
