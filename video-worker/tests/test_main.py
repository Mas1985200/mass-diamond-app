# video-worker/tests/test_main.py
# The worker's main work, with a fake queue and a fake model (no GPU, no network):
# a task is made, joined, uploaded and completed; every kind of failure is reported
# with the right "try again?" answer; a lost lease stops the task at once; a worker
# without a GPU stops; the loop backs off when the queue is quiet. Skipped where
# ffmpeg is not installed. Run from the video-worker folder:
#   python -m unittest tests.test_main

import shutil
import tempfile
import unittest
from pathlib import Path

from worker.api import ApiError, Task
from worker.config import load_config
from worker.main import TaskRunner, WorkerFatal, serve
from worker.models.base import BackendError

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


class FakeBackend:
    name = "fake"

    def __init__(self, error: Exception | None = None):
        self.error = error
        self.jobs = []

    def generate(self, job, sink, on_step):
        self.jobs.append(job)
        if self.error is not None:
            raise self.error
        frame = bytes([30, 90, 150]) * (job.width * job.height)
        for i in range(job.frames):
            sink.write(frame)
            if i % 8 == 0:
                on_step(i / job.frames)
        on_step(1.0)

    def close(self):
        pass


class FakeApi:
    def __init__(self, ours: bool = True, complete_ok: bool = True):
        self.ours = ours
        self.complete_ok = complete_ok
        self.progress: list[int] = []
        self.uploads: list[tuple[str, int, str]] = []
        self.completed: list[tuple[str, str, float]] = []
        self.failed: list[tuple[str, str, str, bool]] = []
        self.progress_error: ApiError | None = None
        self.fail_error: ApiError | None = None
        self.queue: list = []
        self.claims = 0

    def report_progress(self, task_id, percent):
        if self.progress_error is not None:
            raise self.progress_error
        self.progress.append(percent)
        return self.ours

    def upload_file(self, path, file, content_type):
        self.uploads.append((path, file.stat().st_size, content_type))

    def complete_task(self, task_id, path, duration):
        self.completed.append((task_id, path, duration))
        return self.complete_ok

    def fail_task(self, task_id, code, message, retryable):
        if self.fail_error is not None:
            raise self.fail_error
        self.failed.append((task_id, code, message, retryable))
        return True

    def claim_task(self):
        self.claims += 1
        item = self.queue.pop(0) if self.queue else None
        if isinstance(item, Exception):
            raise item
        return item


def make_task(**request):
    base = {"prompt": "A red fox in snow", "quality": "draft", "duration_seconds": 2}
    base.update(request)
    return Task(id="task-1", request=base, attempts=1, max_attempts=3)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg is not installed")
class RunTaskTests(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.addCleanup(self._folder.cleanup)
        self.config = load_config({
            "SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "secret-key",
            "WORK_DIR": self._folder.name,
            "HEARTBEAT_SECONDS": "30",
        })
        self.clock = Clock()

    def runner(self, api, backend=None, fetch=None):
        return TaskRunner(
            self.config, api, backend or FakeBackend(),
            fetch or (lambda url, dest: dest.write_bytes(b"pic")), self.clock,
        )

    def test_a_task_is_made_joined_uploaded_and_completed(self):
        api = FakeApi()
        self.runner(api).run_task(make_task())
        self.assertEqual(api.failed, [])
        self.assertEqual(len(api.uploads), 1)
        path, size, kind = api.uploads[0]
        self.assertEqual((path, kind), ("worker/task-1/video.mp4", "video/mp4"))
        self.assertGreater(size, 0)
        task_id, done_path, duration = api.completed[0]
        self.assertEqual((task_id, done_path), ("task-1", path))
        self.assertAlmostEqual(duration, 2.0, delta=0.4)
        self.assertFalse((Path(self._folder.name) / "task-1").exists())

    def test_progress_never_goes_back_and_never_says_done(self):
        api = FakeApi()
        self.clock.now = 0.0

        class Stepping(FakeBackend):
            def generate(inner, job, sink, on_step):  # noqa: N805
                self.clock.now += 100.0  # every step is long after the last report
                super().generate(job, sink, on_step)

        self.runner(api, Stepping()).run_task(make_task())
        self.assertTrue(api.progress)
        self.assertEqual(api.progress, sorted(api.progress))
        self.assertLessEqual(max(api.progress), 99)
        self.assertEqual(api.progress[-2:], [92, 97])

    def test_progress_is_reported_at_most_every_heartbeat(self):
        api = FakeApi()
        self.runner(api).run_task(make_task())  # the clock never moves
        self.assertEqual(api.progress, [92, 97])

    def test_a_request_that_can_never_work_is_final_and_costs_no_gpu_time(self):
        api, backend = FakeApi(), FakeBackend()
        self.runner(api, backend).run_task(make_task(aspect_ratio="4:3"))
        self.assertEqual(backend.jobs, [])
        self.assertEqual(len(api.failed), 1)
        _id, code, _message, retryable = api.failed[0]
        self.assertEqual((code, retryable), ("invalid_request", False))
        self.assertEqual(api.completed, [])

    def test_the_model_failure_is_reported_as_it_is(self):
        for retryable in (True, False):
            api = FakeApi()
            error = BackendError("gpu_out_of_memory", "no memory", retryable)
            self.runner(api, FakeBackend(error)).run_task(make_task())
            self.assertEqual(api.failed, [("task-1", "gpu_out_of_memory", "no memory", retryable)])
            self.assertEqual(api.uploads, [])

    def test_a_lost_lease_stops_the_task_quietly(self):
        api = FakeApi(ours=False)

        class Slow(FakeBackend):
            def generate(inner, job, sink, on_step):  # noqa: N805
                self.clock.now += 100.0
                super().generate(job, sink, on_step)

        self.runner(api, Slow()).run_task(make_task())
        self.assertEqual((api.failed, api.completed, api.uploads), ([], [], []))
        self.assertFalse((Path(self._folder.name) / "task-1").exists())

    def test_a_network_blip_while_reporting_does_not_kill_the_render(self):
        api = FakeApi()
        api.progress_error = ApiError("blip", 503, True)
        self.runner(api).run_task(make_task())
        self.assertEqual(len(api.completed), 1)

    def test_a_final_report_error_stops_the_task_and_is_reported(self):
        api = FakeApi()
        api.progress_error = ApiError("forbidden", 403, False)
        self.runner(api).run_task(make_task())
        self.assertEqual(api.completed, [])
        self.assertEqual(api.failed[0][1:2], ("api_error",))

    def test_a_task_taken_away_at_the_end_is_not_an_error(self):
        api = FakeApi(complete_ok=False)
        self.runner(api).run_task(make_task())
        self.assertEqual(api.failed, [])

    def test_a_surprise_is_reported_without_details_and_the_worker_goes_on(self):
        api = FakeApi()
        self.runner(api, FakeBackend(RuntimeError("secret-key leaked here"))).run_task(make_task())
        _id, code, message, retryable = api.failed[0]
        self.assertEqual((code, retryable), ("worker_error", True))
        self.assertEqual(message, "RuntimeError")
        self.assertNotIn("secret-key", message)

    def test_a_failure_that_cannot_be_reported_does_not_crash_the_worker(self):
        api = FakeApi()
        api.fail_error = ApiError("down", 503, True)
        self.runner(api, FakeBackend(BackendError("bad_output", "x", True))).run_task(make_task())

    def test_a_worker_without_a_gpu_reports_the_task_and_stops(self):
        api = FakeApi()
        error = BackendError("no_gpu", "This machine has no GPU for video.", True)
        with self.assertRaises(WorkerFatal):
            self.runner(api, FakeBackend(error)).run_task(make_task())
        self.assertEqual(api.failed, [("task-1", "no_gpu", "This machine has no GPU for video.", True)])

    def test_a_picture_task_downloads_its_pictures(self):
        api, fetched = FakeApi(), []

        def fetch(url, dest):
            fetched.append(url)
            dest.write_bytes(b"pic")

        task = make_task(kind="image_to_video", image_urls=["https://files.example/a.png"])
        self.runner(api, fetch=fetch).run_task(task)
        self.assertEqual(fetched, ["https://files.example/a.png"])
        self.assertEqual(len(api.completed), 1)


class ServeTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config({
            "SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "k",
            "IDLE_POLL_SECONDS": "2",
            "MAX_IDLE_POLL_SECONDS": "10",
        })

    class Runner:
        def __init__(self):
            self.tasks = []

        def run_task(self, task):
            self.tasks.append(task)

    def drive(self, api, rounds):
        runner, sleeps, calls = self.Runner(), [], [0]

        def stop():
            calls[0] += 1
            return calls[0] > rounds

        serve(self.config, api, runner, stop, sleeps.append)
        return runner, sleeps

    def test_a_quiet_queue_is_asked_less_and_less_often_up_to_a_limit(self):
        _runner, sleeps = self.drive(FakeApi(), 6)
        self.assertEqual(sleeps, [2, 3.0, 4.5, 6.75, 10, 10])

    def test_a_task_is_run_and_the_wait_starts_again(self):
        api = FakeApi()
        api.queue = [None, None, make_task(), None]
        runner, sleeps = self.drive(api, 4)
        self.assertEqual([t.id for t in runner.tasks], ["task-1"])
        self.assertEqual(sleeps, [2, 3.0, 2])

    def test_a_queue_that_cannot_be_reached_does_not_stop_the_worker(self):
        api = FakeApi()
        api.queue = [ApiError("down", 503, True), ApiError("down", 503, True), make_task()]
        runner, sleeps = self.drive(api, 3)
        self.assertEqual(sleeps, [2, 4])
        self.assertEqual(len(runner.tasks), 1)

    def test_it_stops_when_asked_without_taking_another_task(self):
        api = FakeApi()
        api.queue = [make_task()]
        runner, _sleeps = self.drive(api, 0)
        self.assertEqual((runner.tasks, api.claims), ([], 0))


if __name__ == "__main__":
    unittest.main()
