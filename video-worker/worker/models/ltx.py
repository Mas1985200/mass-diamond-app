# video-worker/worker/models/ltx.py
# The first real video model: LTX-Video (open weights) through the diffusers
# library, on the worker's GPU. A scene with a start picture is made by the
# image-to-video pipeline, a scene without one by the text-to-video pipeline; both
# share the same weights, so the GPU holds the model once.
#
# Everything that needs torch or diffusers is inside `load_diffusers_runtime`, so
# this file can be imported and tested anywhere. The runtime is injected: tests
# use a fake one, the worker uses the real one.

from __future__ import annotations

import gc
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .base import BackendError, FrameSink, SceneJob

NEGATIVE_PROMPT = "worst quality, inconsistent motion, blurry, jittery, distorted"
# More steps: better detail and slower work.
STEPS_BY_QUALITY = {"draft": 20, "standard": 30, "high": 50}
_DECODE_TIMESTEP = 0.03
_DECODE_NOISE_SCALE = 0.025
_BIG_GPU_BYTES = 30 * 1024**3


@dataclass(frozen=True)
class LtxRuntime:
    text_pipeline: Any
    image_pipeline: Any
    make_generator: Callable[[int], Any]
    empty_cache: Callable[[], None]
    # Exceptions that mean "the GPU ran out of memory".
    oom_types: tuple[type[BaseException], ...]


def load_diffusers_runtime(model_id: str, device: str) -> LtxRuntime:
    """Loads the model onto the GPU. A big GPU holds it as it is; a small one
    (like Kaggle's 16 GB) keeps the weights in 8 bits and moves the layers in
    and out of the GPU as they are needed."""
    import torch
    from diffusers import AutoModel, LTXImageToVideoPipeline, LTXPipeline
    from diffusers.hooks import apply_group_offloading

    if not device.startswith("cuda") or not torch.cuda.is_available():
        raise BackendError("no_gpu", "This machine has no GPU for video.", True)

    major, _minor = torch.cuda.get_device_capability(0)
    dtype = torch.bfloat16 if major >= 8 else torch.float16
    total_memory = torch.cuda.get_device_properties(0).total_memory

    if total_memory >= _BIG_GPU_BYTES:
        text = LTXPipeline.from_pretrained(model_id, dtype=dtype)
        text.to(device)
    else:
        transformer = AutoModel.from_pretrained(model_id, subfolder="transformer", dtype=dtype)
        transformer.enable_layerwise_casting(
            storage_dtype=torch.float8_e4m3fn, compute_dtype=dtype
        )
        text = LTXPipeline.from_pretrained(model_id, transformer=transformer, dtype=dtype)
        onload = torch.device(device)
        offload = torch.device("cpu")
        text.transformer.enable_group_offload(
            onload_device=onload,
            offload_device=offload,
            offload_type="leaf_level",
            use_stream=True,
        )
        apply_group_offloading(
            text.text_encoder, onload_device=onload, offload_type="block_level", num_blocks_per_group=2
        )
        apply_group_offloading(text.vae, onload_device=onload, offload_type="leaf_level")

    text.vae.enable_tiling()
    image = LTXImageToVideoPipeline(**text.components)

    def make_generator(seed: int) -> Any:
        return torch.Generator(device="cpu").manual_seed(seed)

    return LtxRuntime(
        text_pipeline=text,
        image_pipeline=image,
        make_generator=make_generator,
        empty_cache=torch.cuda.empty_cache,
        oom_types=(torch.cuda.OutOfMemoryError,),
    )


def load_start_image(path: Path, width: int, height: int) -> Any:
    """Opens the start picture and crops it to the frame, filling it fully."""
    from PIL import Image, ImageOps

    try:
        with Image.open(path) as opened:
            return ImageOps.fit(opened.convert("RGB"), (width, height), Image.LANCZOS)
    except Exception as error:  # a broken picture can never work on any machine
        raise BackendError("bad_image", "The start picture could not be read.", False) from error


def to_uint8(frames: Any) -> np.ndarray:
    """Model output (frames, height, width, 3) as 0-255 bytes."""
    array = np.asarray(frames)
    if array.ndim != 4 or array.shape[-1] != 3:
        raise BackendError("bad_output", "The model returned frames in an unexpected shape.", True)
    if array.dtype == np.uint8:
        return array
    scaled = np.clip(np.nan_to_num(array.astype(np.float32)), 0.0, 1.0) * 255.0
    return scaled.round().astype(np.uint8)


class LtxVideoBackend:
    name = "ltx-video"

    def __init__(
        self,
        model_id: str,
        device: str = "cuda",
        loader: Callable[[str, str], LtxRuntime] = load_diffusers_runtime,
        image_loader: Callable[[Path, int, int], Any] = load_start_image,
    ) -> None:
        self._model_id = model_id
        self._device = device
        self._loader = loader
        self._image_loader = image_loader
        self._runtime: LtxRuntime | None = None

    def _ready(self) -> LtxRuntime:
        if self._runtime is None:
            self._runtime = self._loader(self._model_id, self._device)
        return self._runtime

    def generate(
        self,
        job: SceneJob,
        sink: FrameSink,
        on_step: Callable[[float], None],
    ) -> None:
        runtime = self._ready()
        steps = STEPS_BY_QUALITY.get(job.quality, STEPS_BY_QUALITY["standard"])

        def on_step_end(_pipe: Any, step: int, _timestep: Any, tensors: dict[str, Any]) -> dict[str, Any]:
            on_step(min(1.0, (step + 1) / steps))
            return tensors

        arguments: dict[str, Any] = {
            "prompt": job.prompt,
            "negative_prompt": NEGATIVE_PROMPT,
            "width": job.width,
            "height": job.height,
            "num_frames": job.frames,
            "frame_rate": job.fps,
            "num_inference_steps": steps,
            "decode_timestep": _DECODE_TIMESTEP,
            "decode_noise_scale": _DECODE_NOISE_SCALE,
            "generator": runtime.make_generator(job.seed),
            "output_type": "np",
            "callback_on_step_end": on_step_end,
        }

        if job.start_image is not None:
            arguments["image"] = self._image_loader(job.start_image, job.width, job.height)
            pipeline = runtime.image_pipeline
        else:
            pipeline = runtime.text_pipeline

        try:
            result = pipeline(**arguments)
        except runtime.oom_types as error:
            runtime.empty_cache()
            raise BackendError(
                "gpu_out_of_memory", "The GPU ran out of memory for this scene.", True
            ) from error

        frames = to_uint8(result.frames[0])
        if len(frames) < job.frames:
            raise BackendError(
                "bad_output",
                f"The model made {len(frames)} frames, expected {job.frames}.",
                True,
            )
        for frame in frames[: job.frames]:
            sink.write(np.ascontiguousarray(frame))
        on_step(1.0)

    def close(self) -> None:
        """Lets go of the model and gives the GPU memory back."""
        runtime, self._runtime = self._runtime, None
        if runtime is None:
            return
        empty_cache = runtime.empty_cache
        del runtime
        gc.collect()
        empty_cache()
