# video-worker/worker/config.py
# Every setting of a Mass Diamond video worker, read once from the environment.
# The same program runs on any GPU (Kaggle, Colab, a rented server): only the
# environment changes. Nothing secret is ever written in the code.

from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

_WORKER_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")


class ConfigError(Exception):
    """A required setting is missing or wrong. The message says which one."""


@dataclass(frozen=True)
class WorkerConfig:
    supabase_url: str
    service_role_key: str
    worker_id: str
    bucket: str
    lease_seconds: int
    heartbeat_seconds: int
    idle_poll_seconds: float
    max_idle_poll_seconds: float
    work_dir: Path
    video_model: str
    device: str


def _text(env: Mapping[str, str], name: str, default: str | None = None) -> str:
    value = (env.get(name) or "").strip()
    if value:
        return value
    if default is not None:
        return default
    raise ConfigError(f"Missing setting: {name}")


def _number(
    env: Mapping[str, str],
    name: str,
    default: float,
    low: float,
    high: float,
) -> float:
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as error:
        raise ConfigError(f"{name} must be a number, got: {raw}") from error
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low} and {high}, got: {raw}")
    return value


def default_worker_id() -> str:
    host = re.sub(r"[^A-Za-z0-9._-]", "-", socket.gethostname())[:60] or "worker"
    return f"{host}-{os.getpid()}"


def load_config(env: Mapping[str, str] | None = None) -> WorkerConfig:
    source: Mapping[str, str] = os.environ if env is None else env

    url = _text(source, "SUPABASE_URL").rstrip("/")
    if not url.startswith("https://"):
        raise ConfigError("SUPABASE_URL must start with https://")

    worker_id = _text(source, "WORKER_ID", default_worker_id())
    if not _WORKER_ID_RE.match(worker_id):
        raise ConfigError("WORKER_ID may only use letters, digits and . _ : - (max 100)")

    lease = int(_number(source, "LEASE_SECONDS", 600, 60, 3600))
    heartbeat = int(_number(source, "HEARTBEAT_SECONDS", 30, 5, 300))
    if heartbeat * 3 > lease:
        raise ConfigError("HEARTBEAT_SECONDS must be at most a third of LEASE_SECONDS")

    idle = _number(source, "IDLE_POLL_SECONDS", 3, 0.5, 60)
    max_idle = _number(source, "MAX_IDLE_POLL_SECONDS", 15, idle, 300)

    return WorkerConfig(
        supabase_url=url,
        service_role_key=_text(source, "SUPABASE_SERVICE_ROLE_KEY"),
        worker_id=worker_id,
        bucket=_text(source, "VIDEO_BUCKET", "videos"),
        lease_seconds=lease,
        heartbeat_seconds=heartbeat,
        idle_poll_seconds=idle,
        max_idle_poll_seconds=max_idle,
        work_dir=Path(_text(source, "WORK_DIR", "/tmp/md-video-worker")),
        video_model=_text(source, "VIDEO_MODEL", "Lightricks/LTX-Video"),
        device=_text(source, "DEVICE", "cuda"),
    )
