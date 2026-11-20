# video-worker/worker/pipeline/plan.py
# The plan of one video: the exact scenes the worker will make. A short video is
# one or a few scenes; a long one (up to 10 minutes) is many scenes of a few
# seconds that continue each other, so the picture, the voice and the music can
# be made scene by scene on any GPU and joined at the end.
#
# The request (made by the self-worker engine) is checked here, once, before any
# GPU time is spent. Pure Python: no model, no network, fully testable.
#
# Request contract (JSON object):
#   kind              text_to_video | image_to_video | multi_image_to_video
#   prompt            the professional prompt (English), 1..2000 characters
#   style             auto | realistic | cinematic | animation | advertising | educational
#   aspect_ratio      16:9 | 9:16 | 1:1
#   quality           draft | standard | high
#   duration_seconds  1..600 (ignored when "scenes" is given: their sum is used)
#   seed              optional integer
#   image_urls        https links of the pictures to animate (by kind)
#   scenes            optional list written by the director:
#                       {prompt, seconds 1..10, narration?, image_index?, transition?}
#   audio             optional {narration, music, sfx, language, music_prompt}

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Mapping

MIN_VIDEO_SECONDS = 1
MAX_VIDEO_SECONDS = 600
TARGET_SCENE_SECONDS = 6
MAX_SCENE_SECONDS = 10
MAX_SCENES = 150
MAX_IMAGES = 10
MAX_PROMPT_CHARS = 2000
MAX_NARRATION_CHARS = 1500
MAX_MUSIC_PROMPT_CHARS = 500
FPS = 24

CONTINUATION_HINT = (
    "Continue the same shot without a cut: same subject, same place, "
    "same style and lighting, natural motion."
)

KINDS = ("text_to_video", "image_to_video", "multi_image_to_video")
STYLES = ("auto", "realistic", "cinematic", "animation", "advertising", "educational")
ASPECT_RATIOS = ("16:9", "9:16", "1:1")
QUALITIES = ("draft", "standard", "high")
TRANSITIONS = ("cut", "fade")

# Every side is a multiple of 32, as the video model needs.
_SIZES: dict[str, dict[str, tuple[int, int]]] = {
    "16:9": {"draft": (640, 352), "standard": (768, 448), "high": (1024, 576)},
    "9:16": {"draft": (352, 640), "standard": (448, 768), "high": (576, 1024)},
    "1:1": {"draft": (480, 480), "standard": (640, 640), "high": (768, 768)},
}

_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


class PlanError(Exception):
    """The request can never be made as written. Not worth retrying."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = "invalid_request"


@dataclass(frozen=True)
class SceneSpec:
    index: int
    prompt: str
    seconds: int
    frames: int
    image_index: int | None
    narration: str | None
    transition: str


@dataclass(frozen=True)
class AudioPlan:
    narration: bool
    music: bool
    sfx: bool
    language: str
    music_prompt: str | None


@dataclass(frozen=True)
class VideoPlan:
    kind: str
    style: str
    aspect_ratio: str
    quality: str
    width: int
    height: int
    fps: int
    seed: int | None
    scenes: tuple[SceneSpec, ...]
    image_urls: tuple[str, ...]
    audio: AudioPlan

    @property
    def total_seconds(self) -> int:
        return sum(scene.seconds for scene in self.scenes)


# -- small helpers -----------------------------------------------------------


def frames_for(seconds: int) -> int:
    """Frame count the model accepts: 8k + 1 (24 fps makes it exact)."""
    return seconds * FPS + 1


def frame_size(aspect_ratio: str, quality: str) -> tuple[int, int]:
    return _SIZES[aspect_ratio][quality]


def split_seconds(total: int) -> list[int]:
    """Cuts a total into scene lengths that differ by at most one second."""
    count = max(1, math.ceil(total / TARGET_SCENE_SECONDS))
    base, extra = divmod(total, count)
    return [base + 1 if i < extra else base for i in range(count)]


def assign_images(scene_count: int, image_count: int) -> list[int | None]:
    """Spreads the pictures over the scenes: each picture starts one scene and
    the scenes in between continue from the last frame."""
    if image_count <= 0:
        return [None] * scene_count
    starts = {(k * scene_count) // image_count: k for k in range(image_count)}
    return [starts.get(i) for i in range(scene_count)]


def _choice(value: Any, name: str, allowed: tuple[str, ...], default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str) or value not in allowed:
        raise PlanError(f"{name} must be one of: {', '.join(allowed)}")
    return value


def _text(value: Any, name: str, limit: int, required: bool) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise PlanError(f"{name} is required")
        return None
    if not isinstance(value, str):
        raise PlanError(f"{name} must be text")
    clean = value.strip()
    if len(clean) > limit:
        raise PlanError(f"{name} is longer than {limit} characters")
    return clean


def _whole(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{name} must be a whole number")
    if int(value) != value:
        raise PlanError(f"{name} must be a whole number")
    number = int(value)
    if not low <= number <= high:
        raise PlanError(f"{name} must be between {low} and {high}")
    return number


def _bool(value: Any, name: str, default: bool) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise PlanError(f"{name} must be true or false")
    return value


def _image_urls(value: Any, kind: str) -> tuple[str, ...]:
    if value is None:
        value = []
    if not isinstance(value, list) or len(value) > MAX_IMAGES:
        raise PlanError(f"image_urls must be a list of at most {MAX_IMAGES} links")
    urls: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.startswith("https://") or len(item) > 2048:
            raise PlanError("every image link must be an https link")
        urls.append(item)
    needed = {"text_to_video": (0, 0), "image_to_video": (1, 1), "multi_image_to_video": (2, MAX_IMAGES)}[kind]
    if not needed[0] <= len(urls) <= needed[1]:
        raise PlanError(f"{kind} needs {needed[0]} to {needed[1]} pictures, got {len(urls)}")
    return tuple(urls)


def _audio(value: Any, any_narration: bool) -> AudioPlan:
    raw: Mapping[str, Any] = {}
    if value is not None:
        if not isinstance(value, dict):
            raise PlanError("audio must be an object")
        raw = value
    language = raw.get("language", "en")
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language):
        raise PlanError("audio.language must be a language code like en or fa")
    narration_wanted = _bool(raw.get("narration"), "audio.narration", True)
    return AudioPlan(
        narration=narration_wanted and any_narration,
        music=_bool(raw.get("music"), "audio.music", True),
        sfx=_bool(raw.get("sfx"), "audio.sfx", True),
        language=language,
        music_prompt=_text(raw.get("music_prompt"), "audio.music_prompt", MAX_MUSIC_PROMPT_CHARS, False),
    )


# -- scenes ------------------------------------------------------------------


def _auto_scenes(base_prompt: str, total: int, image_count: int) -> list[SceneSpec]:
    lengths = split_seconds(total)
    if len(lengths) < image_count:
        # Every picture needs a scene of its own.
        if total < image_count:
            raise PlanError("the video is too short for that many pictures")
        lengths = [total // image_count + (1 if i < total % image_count else 0) for i in range(image_count)]
    images = assign_images(len(lengths), image_count)
    scenes: list[SceneSpec] = []
    for index, seconds in enumerate(lengths):
        prompt = base_prompt if index == 0 else f"{base_prompt} {CONTINUATION_HINT}"
        scenes.append(
            SceneSpec(
                index=index,
                prompt=prompt[:MAX_PROMPT_CHARS],
                seconds=seconds,
                frames=frames_for(seconds),
                image_index=images[index],
                narration=None,
                transition="cut",
            )
        )
    return scenes


def _written_scenes(raw: Any, image_count: int) -> list[SceneSpec]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_SCENES:
        raise PlanError(f"scenes must be a list of 1 to {MAX_SCENES} scenes")
    parsed: list[dict[str, Any]] = []
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            raise PlanError(f"scene {position + 1} must be an object")
        label = f"scene {position + 1}"
        image_index = item.get("image_index")
        if image_index is not None:
            image_index = _whole(image_index, f"{label} image_index", 0, max(0, image_count - 1))
            if image_count == 0:
                raise PlanError(f"{label} names a picture but there are none")
        parsed.append(
            {
                "prompt": _text(item.get("prompt"), f"{label} prompt", MAX_PROMPT_CHARS, True),
                "seconds": _whole(item.get("seconds"), f"{label} seconds", 1, MAX_SCENE_SECONDS),
                "narration": _text(item.get("narration"), f"{label} narration", MAX_NARRATION_CHARS, False),
                "image_index": image_index,
                "transition": _choice(item.get("transition"), f"{label} transition", TRANSITIONS, "cut"),
            }
        )

    if image_count > 0 and all(p["image_index"] is None for p in parsed):
        if len(parsed) < image_count:
            raise PlanError("there are fewer scenes than pictures")
        for position, image in enumerate(assign_images(len(parsed), image_count)):
            parsed[position]["image_index"] = image

    scenes = [
        SceneSpec(
            index=position,
            prompt=str(p["prompt"]),
            seconds=int(p["seconds"]),
            frames=frames_for(int(p["seconds"])),
            image_index=p["image_index"],
            narration=p["narration"],
            transition=str(p["transition"]),
        )
        for position, p in enumerate(parsed)
    ]
    return scenes


# -- the entry point ---------------------------------------------------------


def parse_plan(request: Mapping[str, Any]) -> VideoPlan:
    """Checks a task request and turns it into the plan. Raises PlanError."""
    if not isinstance(request, Mapping):
        raise PlanError("the request must be an object")

    kind = _choice(request.get("kind"), "kind", KINDS, "text_to_video")
    style = _choice(request.get("style"), "style", STYLES, "auto")
    aspect = _choice(request.get("aspect_ratio"), "aspect_ratio", ASPECT_RATIOS, "16:9")
    quality = _choice(request.get("quality"), "quality", QUALITIES, "standard")
    urls = _image_urls(request.get("image_urls"), kind)

    seed_raw = request.get("seed")
    seed = None if seed_raw is None else _whole(seed_raw, "seed", 0, 2**31 - 1)

    if request.get("scenes") is not None:
        scenes = _written_scenes(request.get("scenes"), len(urls))
    else:
        prompt = _text(request.get("prompt"), "prompt", MAX_PROMPT_CHARS, True)
        total = _whole(request.get("duration_seconds"), "duration_seconds", MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS)
        scenes = _auto_scenes(str(prompt), total, len(urls))

    total_seconds = sum(scene.seconds for scene in scenes)
    if not MIN_VIDEO_SECONDS <= total_seconds <= MAX_VIDEO_SECONDS:
        raise PlanError(f"the video must last {MIN_VIDEO_SECONDS} to {MAX_VIDEO_SECONDS} seconds")

    any_narration = any(scene.narration for scene in scenes)
    width, height = frame_size(aspect, quality)
    return VideoPlan(
        kind=kind,
        style=style,
        aspect_ratio=aspect,
        quality=quality,
        width=width,
        height=height,
        fps=FPS,
        seed=seed,
        scenes=tuple(scenes),
        image_urls=urls,
        audio=_audio(request.get("audio"), any_narration),
    )
