# video-worker/worker/api.py
# The only door between a video worker and Supabase: take the next task, report
# progress, hand in the result or the failure, and upload the finished file.
# Standard library only, so it runs on any GPU machine without installing
# anything. The service key is sent in headers and never written in a message.

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from .config import WorkerConfig

RESULT_PREFIX = "worker/"
_RPC_TIMEOUT_SECONDS = 30
_UPLOAD_TIMEOUT_SECONDS = 900
_TRANSIENT_STATUS = {408, 425, 429, 500, 502, 503, 504}
_RETRY_DELAYS_SECONDS = (1.0, 2.0, 4.0)


class ApiError(Exception):
    """A call to Supabase failed. `retryable` says whether trying again may work."""

    def __init__(self, message: str, status: int | None, retryable: bool) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class Task:
    id: str
    request: Mapping[str, Any]
    attempts: int
    max_attempts: int


def result_path(task_id: str, extension: str = "mp4") -> str:
    """Where the finished video of a task lives in the bucket."""
    clean = extension.lower().lstrip(".")
    if clean not in ("mp4", "webm"):
        raise ValueError("extension must be mp4 or webm")
    return f"{RESULT_PREFIX}{task_id}/video.{clean}"


def _task_from_row(row: Mapping[str, Any]) -> Task:
    request = row.get("request")
    if not isinstance(request, dict):
        raise ApiError("The task has no request.", None, False)
    return Task(
        id=str(row["id"]),
        request=request,
        attempts=int(row.get("attempts", 0)),
        max_attempts=int(row.get("max_attempts", 3)),
    )


class SupabaseApi:
    def __init__(
        self,
        config: WorkerConfig,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._config = config
        self._sleep = sleep

    # -- low level -----------------------------------------------------------

    def _headers(self, extra: Mapping[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self._config.service_role_key,
            "Authorization": f"Bearer {self._config.service_role_key}",
        }
        if extra:
            headers.update(extra)
        return headers

    def _send(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body_factory: Callable[[], Any] | None,
        timeout: float,
    ) -> bytes:
        """One call with a few retries for network trouble and busy servers.

        `body_factory` makes a fresh body for every try (a file must be opened
        again), and is closed afterwards when it has a close method.
        """
        last: ApiError | None = None
        for attempt in range(len(_RETRY_DELAYS_SECONDS) + 1):
            body = body_factory() if body_factory else None
            try:
                request = urllib.request.Request(
                    url, data=body, headers=dict(headers), method=method
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return response.read()
            except urllib.error.HTTPError as error:
                detail = error.read(300).decode("utf-8", "replace")
                last = ApiError(
                    f"Supabase answered {error.code}: {detail}",
                    error.code,
                    error.code in _TRANSIENT_STATUS,
                )
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                last = ApiError(f"Network problem: {type(error).__name__}", None, True)
            finally:
                if body is not None and hasattr(body, "close"):
                    body.close()

            if not last.retryable or attempt >= len(_RETRY_DELAYS_SECONDS):
                break
            self._sleep(_RETRY_DELAYS_SECONDS[attempt])
        assert last is not None
        raise last

    def _rpc(self, name: str, params: Mapping[str, Any]) -> Any:
        url = f"{self._config.supabase_url}/rest/v1/rpc/{name}"
        payload = json.dumps(params).encode("utf-8")
        raw = self._send(
            "POST",
            url,
            self._headers({"Content-Type": "application/json"}),
            lambda: payload,
            _RPC_TIMEOUT_SECONDS,
        )
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError as error:
            raise ApiError("Supabase sent an unreadable answer.", None, True) from error

    # -- the queue -----------------------------------------------------------

    def claim_task(self) -> Task | None:
        """The next task for this worker, or None when the queue is empty."""
        rows = self._rpc(
            "claim_video_worker_task",
            {
                "p_worker": self._config.worker_id,
                "p_lease_seconds": self._config.lease_seconds,
            },
        )
        if not rows:
            return None
        if not isinstance(rows, list):
            raise ApiError("Unexpected answer to a task claim.", None, True)
        return _task_from_row(rows[0])

    def report_progress(self, task_id: str, percent: int) -> bool:
        """Keeps the lease alive. False means the task is no longer ours: stop."""
        value = max(0, min(99, int(percent)))
        answer = self._rpc(
            "progress_video_worker_task",
            {
                "p_task": task_id,
                "p_worker": self._config.worker_id,
                "p_progress": value,
                "p_lease_seconds": self._config.lease_seconds,
            },
        )
        return answer is True

    def complete_task(self, task_id: str, path: str, duration_seconds: float) -> bool:
        if not path.startswith(RESULT_PREFIX):
            raise ValueError(f"result path must start with {RESULT_PREFIX}")
        answer = self._rpc(
            "complete_video_worker_task",
            {
                "p_task": task_id,
                "p_worker": self._config.worker_id,
                "p_result_path": path,
                "p_duration": round(max(0.0, duration_seconds), 2),
            },
        )
        return answer is True

    def fail_task(
        self, task_id: str, code: str, message: str, retryable: bool
    ) -> bool:
        answer = self._rpc(
            "fail_video_worker_task",
            {
                "p_task": task_id,
                "p_worker": self._config.worker_id,
                "p_code": code[:60] or "worker_error",
                "p_message": message[:500],
                "p_retryable": bool(retryable),
            },
        )
        return answer is True

    # -- the files -----------------------------------------------------------

    def upload_file(self, path: str, file: Path, content_type: str) -> None:
        """Puts a finished file into the bucket (replacing an older try)."""
        if not path.startswith(RESULT_PREFIX) or ".." in path.split("/"):
            raise ValueError(f"upload path must be inside {RESULT_PREFIX}")
        size = os.path.getsize(file)
        if size <= 0:
            raise ApiError("The file to upload is empty.", None, False)
        quoted = urllib.parse.quote(path, safe="/")
        url = f"{self._config.supabase_url}/storage/v1/object/{self._config.bucket}/{quoted}"
        self._send(
            "POST",
            url,
            self._headers(
                {
                    "Content-Type": content_type,
                    "Content-Length": str(size),
                    "x-upsert": "true",
                }
            ),
            lambda: open(file, "rb"),
            _UPLOAD_TIMEOUT_SECONDS,
        )
