# video-worker/worker/main.py
# The heart of a Mass Diamond video worker: take the next task from the queue,
# make the video scene by scene on this machine's GPU, join the scenes, upload
# the file and report. It then asks for the next task, for ever. The same
# program runs on any GPU (Kaggle, a rented server, our own machine):
#
#     python -m worker.main
#
# Every failure is reported with a clear code and a "worth trying again?" answer,
# so a task never disappears: another worker takes it, or it ends as failed and
# the video engine moves to its next engine. A worker that lost its lease (it was
# too slow, or the task was taken away) stops that task at once.

from __future__ import annotations

import logging
import shutil
import signal
import time
from pathlib import Path
from typing import Callable

from .api import ApiError, SupabaseApi, Task, result_path
from .config import WorkerConfig, load_config
from .models.base import BackendError, TaskCancelled, VideoBackend
from .pipeline.images import download_image
from .pipeline.media import MediaError, concat_videos, probe_duration
from .pipeline.plan import PlanError, parse_plan
from .pipeline.scenes import ImageFetcher, make_scenes

log = logging.getLogger("worker")

# The scenes take the first part of the progress bar; joining and uploading the
# rest. Never 100 here: only the end of the task says 100.
_SCENES_SHARE = 90
_JOINED = 92
_UPLOADED = 97
# A machine with no GPU can never make a video: it must stop, not eat tasks.
_FATAL_CODES = frozenset({"no_gpu"})
# The exit code that says "do not start me again on this machine". Any other
# stop (a crash gives 1) may be started again by whoever runs the worker.
FATAL_EXIT_CODE = 3


class WorkerFatal(Exception):
    """This worker cannot work at all (for example it has no GPU). Stop it."""


class TaskRunner:
    def __init__(
        self,
        config: WorkerConfig,
        api: SupabaseApi,
        backend: VideoBackend,
        fetch_image: ImageFetcher = download_image,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config = config
        self._api = api
        self._backend = backend
        self._fetch_image = fetch_image
        self._clock = clock

    # -- one task ------------------------------------------------------------

    def run_task(self, task: Task) -> None:
        work_dir = self._config.work_dir / task.id
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True, exist_ok=True)
        log.info("task %s: started (try %s of %s)", task.id, task.attempts, task.max_attempts)
        try:
            self._make_and_deliver(task, work_dir)
        except TaskCancelled:
            log.warning("task %s: the lease was lost, stopped", task.id)
        except PlanError as error:
            self._fail(task, error.code, str(error), False)
        except BackendError as error:
            self._fail(task, error.code, str(error), error.retryable)
            if error.code in _FATAL_CODES:
                raise WorkerFatal(str(error)) from error
        except MediaError as error:
            self._fail(task, "media_error", str(error), True)
        except ApiError as error:
            self._fail(task, "api_error", str(error), True)
        except Exception as error:  # never lose a task over a surprise
            log.exception("task %s: unexpected failure", task.id)
            self._fail(task, "worker_error", type(error).__name__, True)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def _make_and_deliver(self, task: Task, work_dir: Path) -> None:
        plan = parse_plan(task.request)
        reporter = _ProgressReporter(self._api, task.id, self._config.heartbeat_seconds, self._clock)

        def on_scene_progress(fraction: float) -> None:
            reporter.report(int(max(0.0, min(1.0, fraction)) * _SCENES_SHARE))

        parts = make_scenes(plan, self._backend, work_dir, self._fetch_image, on_scene_progress)

        reporter.report(_JOINED, force=True)
        final = work_dir / "final.mp4"
        concat_videos(parts, final)
        duration = probe_duration(final)

        path = result_path(task.id)
        self._api.upload_file(path, final, "video/mp4")
        reporter.report(_UPLOADED, force=True)

        if self._api.complete_task(task.id, path, duration):
            log.info("task %s: done, %.1f seconds of video", task.id, duration)
        else:
            log.warning("task %s: finished but the task was no longer ours", task.id)

    def _fail(self, task: Task, code: str, message: str, retryable: bool) -> None:
        log.warning("task %s: failed (%s, retryable=%s): %s", task.id, code, retryable, message)
        try:
            self._api.fail_task(task.id, code, message, retryable)
        except ApiError as error:
            # The lease runs out by itself and the task goes to another worker.
            log.error("task %s: the failure could not be reported: %s", task.id, error)


class _ProgressReporter:
    """Tells the queue how far the task is and keeps the lease alive, but not
    more often than every `interval` seconds. Raises TaskCancelled when the
    queue says the task is no longer ours."""

    def __init__(self, api: SupabaseApi, task_id: str, interval: float, clock: Callable[[], float]) -> None:
        self._api = api
        self._task_id = task_id
        self._interval = interval
        self._clock = clock
        self._last = clock()
        self._best = 0

    def report(self, percent: int, force: bool = False) -> None:
        self._best = max(self._best, percent)
        now = self._clock()
        if not force and now - self._last < self._interval:
            return
        self._last = now
        try:
            still_ours = self._api.report_progress(self._task_id, self._best)
        except ApiError as error:
            if not error.retryable:
                raise
            log.warning("task %s: progress not reported (%s)", self._task_id, error)
            return  # a passing network trouble must not kill a long render
        if not still_ours:
            raise TaskCancelled()


# -- the loop ----------------------------------------------------------------


def serve(
    config: WorkerConfig,
    api: SupabaseApi,
    runner: TaskRunner,
    stop: Callable[[], bool],
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Takes tasks until `stop()` is true. A quiet queue is asked less and less
    often (up to MAX_IDLE_POLL_SECONDS), a busy one at once."""
    idle = config.idle_poll_seconds
    while not stop():
        try:
            task = api.claim_task()
        except ApiError as error:
            log.warning("could not ask for a task: %s", error)
            sleep(idle)
            idle = min(idle * 2, config.max_idle_poll_seconds)
            continue
        if task is None:
            sleep(idle)
            idle = min(idle * 1.5, config.max_idle_poll_seconds)
            continue
        idle = config.idle_poll_seconds
        runner.run_task(task)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # Imported here: only a real worker needs numpy, torch and diffusers.
    from .models.ltx import LtxVideoBackend

    config = load_config()
    api = SupabaseApi(config)
    backend = LtxVideoBackend(config.video_model, config.device)
    runner = TaskRunner(config, api, backend)

    stopping = False

    def request_stop(_signal: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        log.info("stop requested: the current task will finish first")

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    log.info("worker %s is ready", config.worker_id)
    try:
        serve(config, api, runner, lambda: stopping)
    except WorkerFatal as error:
        log.error("this worker cannot work: %s", error)
        raise SystemExit(FATAL_EXIT_CODE) from error
    finally:
        backend.close()


if __name__ == "__main__":
    main()
