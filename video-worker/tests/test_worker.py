# video-worker/tests/test_worker.py
# Checks the worker's settings, its video plan and its Supabase client (against a
# small fake server). Run from the video-worker folder:
#   python -m unittest tests.test_worker

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from worker.api import ApiError, SupabaseApi, result_path
from worker.config import ConfigError, WorkerConfig, load_config
from worker.pipeline.plan import (
    MAX_VIDEO_SECONDS,
    PlanError,
    assign_images,
    frame_size,
    frames_for,
    parse_plan,
    split_seconds,
)

BASE_ENV = {"SUPABASE_URL": "https://x.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "k"}


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        c = load_config(BASE_ENV)
        self.assertEqual(c.supabase_url, "https://x.supabase.co")
        self.assertEqual(c.bucket, "videos")
        self.assertEqual(c.lease_seconds, 600)

    def test_errors(self):
        with self.assertRaises(ConfigError):
            load_config({})
        with self.assertRaises(ConfigError):
            load_config({**BASE_ENV, "SUPABASE_URL": "http://x"})
        with self.assertRaises(ConfigError):
            load_config({**BASE_ENV, "WORKER_ID": "bad id!"})
        with self.assertRaises(ConfigError):
            load_config({**BASE_ENV, "HEARTBEAT_SECONDS": "300", "LEASE_SECONDS": "600"})
        with self.assertRaises(ConfigError):
            load_config({**BASE_ENV, "LEASE_SECONDS": "abc"})


class PlanTests(unittest.TestCase):
    def test_sizes_and_frames(self):
        for aspect in ("16:9", "9:16", "1:1"):
            for q in ("draft", "standard", "high"):
                w, h = frame_size(aspect, q)
                self.assertEqual(w % 32, 0)
                self.assertEqual(h % 32, 0)
        for s in range(1, 11):
            self.assertEqual((frames_for(s) - 1) % 8, 0)

    def test_split(self):
        for total in range(1, MAX_VIDEO_SECONDS + 1):
            parts = split_seconds(total)
            self.assertEqual(sum(parts), total)
            self.assertTrue(all(1 <= p <= 6 for p in parts), (total, parts))
            self.assertLessEqual(max(parts) - min(parts), 1)

    def test_assign_images(self):
        self.assertEqual(assign_images(3, 0), [None, None, None])
        self.assertEqual(assign_images(3, 1), [0, None, None])
        self.assertEqual(assign_images(6, 3), [0, None, 1, None, 2, None])
        self.assertEqual(assign_images(3, 3), [0, 1, 2])
        for n in range(1, 40):
            for m in range(1, min(n, 10) + 1):
                got = assign_images(n, m)
                self.assertEqual([x for x in got if x is not None], list(range(m)))

    def test_text_to_video(self):
        p = parse_plan({"prompt": "a fox", "duration_seconds": 20})
        self.assertEqual(p.total_seconds, 20)
        self.assertEqual(len(p.scenes), 4)
        self.assertNotIn("Continue", p.scenes[0].prompt)
        self.assertIn("Continue", p.scenes[1].prompt)
        self.assertEqual((p.width, p.height), (768, 448))
        self.assertFalse(p.audio.narration)
        self.assertTrue(p.audio.music)

    def test_ten_minutes(self):
        p = parse_plan({"prompt": "a story", "duration_seconds": 600, "quality": "high"})
        self.assertEqual(p.total_seconds, 600)
        self.assertEqual(len(p.scenes), 100)

    def test_image_kinds(self):
        u = "https://a/b.png"
        p = parse_plan({"kind": "image_to_video", "prompt": "x", "duration_seconds": 12, "image_urls": [u]})
        self.assertEqual([s.image_index for s in p.scenes], [0, None])
        p = parse_plan({"kind": "multi_image_to_video", "prompt": "x", "duration_seconds": 4, "image_urls": [u, u, u]})
        self.assertEqual([s.image_index for s in p.scenes], [0, 1, 2])
        with self.assertRaises(PlanError):
            parse_plan({"kind": "multi_image_to_video", "prompt": "x", "duration_seconds": 2, "image_urls": [u, u, u]})
        with self.assertRaises(PlanError):
            parse_plan({"kind": "image_to_video", "prompt": "x", "duration_seconds": 5})
        with self.assertRaises(PlanError):
            parse_plan({"kind": "text_to_video", "prompt": "x", "duration_seconds": 5, "image_urls": [u]})
        with self.assertRaises(PlanError):
            parse_plan({"kind": "image_to_video", "prompt": "x", "duration_seconds": 5, "image_urls": ["http://a"]})

    def test_written_scenes_and_audio(self):
        p = parse_plan(
            {
                "scenes": [
                    {"prompt": "one", "seconds": 5, "narration": "hello"},
                    {"prompt": "two", "seconds": 8, "transition": "fade"},
                ],
                "audio": {"language": "fa", "music_prompt": "calm"},
            }
        )
        self.assertEqual(p.total_seconds, 13)
        self.assertTrue(p.audio.narration)
        self.assertEqual(p.audio.language, "fa")
        self.assertEqual(p.scenes[1].transition, "fade")
        off = parse_plan({"scenes": [{"prompt": "a", "seconds": 3, "narration": "n"}], "audio": {"narration": False}})
        self.assertFalse(off.audio.narration)

    def test_bad_requests(self):
        bad = [
            {},
            {"prompt": "x"},
            {"prompt": "x", "duration_seconds": 0},
            {"prompt": "x", "duration_seconds": 601},
            {"prompt": "x", "duration_seconds": 5.5},
            {"prompt": "x", "duration_seconds": True},
            {"prompt": "x", "duration_seconds": 5, "style": "weird"},
            {"prompt": "x", "duration_seconds": 5, "aspect_ratio": "4:3"},
            {"prompt": "x" * 2001, "duration_seconds": 5},
            {"prompt": "x", "duration_seconds": 5, "seed": -1},
            {"prompt": "x", "duration_seconds": 5, "audio": {"language": "english!"}},
            {"scenes": []},
            {"scenes": [{"prompt": "a", "seconds": 11}]},
            {"scenes": [{"prompt": "a", "seconds": 5, "image_index": 0}]},
            {"scenes": "nope"},
        ]
        for request in bad:
            with self.assertRaises(PlanError, msg=str(request)):
                parse_plan(request)
        with self.assertRaises(PlanError):
            parse_plan("not an object")  # type: ignore[arg-type]


class _Handler(BaseHTTPRequestHandler):
    calls: list = []
    fail_first = 0

    def log_message(self, *args):
        pass

    def _reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        _Handler.calls.append((self.path, self.headers, body))
        if _Handler.fail_first > 0:
            _Handler.fail_first -= 1
            return self._reply(503, {"message": "busy"})
        if self.path.endswith("/claim_video_worker_task"):
            return self._reply(200, [{"id": "t1", "request": {"prompt": "p"}, "attempts": 1, "max_attempts": 3}])
        if self.path.endswith("/progress_video_worker_task"):
            return self._reply(200, True)
        if self.path.endswith("/complete_video_worker_task"):
            return self._reply(200, False)
        if self.path.endswith("/fail_video_worker_task"):
            return self._reply(200, True)
        if "/storage/v1/object/" in self.path:
            return self._reply(200, {"Key": "ok"})
        self._reply(404, {"message": "nope"})


class ApiTests(unittest.TestCase):
    def setUp(self):
        _Handler.calls = []
        _Handler.fail_first = 0
        self.server = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.config = WorkerConfig(
            supabase_url=f"http://127.0.0.1:{self.server.server_port}",
            service_role_key="SECRET",
            worker_id="w1",
            bucket="videos",
            lease_seconds=600,
            heartbeat_seconds=30,
            idle_poll_seconds=3,
            max_idle_poll_seconds=15,
            work_dir=Path("/tmp/x"),
            video_model="m",
            device="cpu",
        )
        self.api = SupabaseApi(self.config, sleep=lambda s: None)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_claim_and_calls(self):
        task = self.api.claim_task()
        self.assertEqual(task.id, "t1")
        self.assertEqual(task.request["prompt"], "p")
        path, headers, body = _Handler.calls[0]
        self.assertEqual(json.loads(body), {"p_worker": "w1", "p_lease_seconds": 600})
        self.assertEqual(headers["apikey"], "SECRET")
        self.assertTrue(self.api.report_progress("t1", 150))
        self.assertEqual(json.loads(_Handler.calls[1][2])["p_progress"], 99)
        self.assertFalse(self.api.complete_task("t1", result_path("t1"), 12.345))
        self.assertEqual(json.loads(_Handler.calls[2][2])["p_duration"], 12.35)
        self.assertTrue(self.api.fail_task("t1", "x" * 100, "m" * 900, True))
        sent = json.loads(_Handler.calls[3][2])
        self.assertEqual(len(sent["p_code"]), 60)
        self.assertEqual(len(sent["p_message"]), 500)

    def test_retry_on_busy(self):
        _Handler.fail_first = 2
        self.assertIsNotNone(self.api.claim_task())
        self.assertEqual(len(_Handler.calls), 3)

    def test_gives_up_and_hides_key(self):
        _Handler.fail_first = 99
        with self.assertRaises(ApiError) as caught:
            self.api.claim_task()
        self.assertTrue(caught.exception.retryable)
        self.assertNotIn("SECRET", str(caught.exception))
        self.assertEqual(len(_Handler.calls), 4)

    def test_upload(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "v.mp4"
            f.write_bytes(b"0123456789")
            self.api.upload_file(result_path("t1"), f, "video/mp4")
            path, headers, body = _Handler.calls[0]
            self.assertEqual(path, "/storage/v1/object/videos/worker/t1/video.mp4")
            self.assertEqual(body, b"0123456789")
            self.assertEqual(headers["x-upsert"], "true")
            with self.assertRaises(ValueError):
                self.api.upload_file("other/x.mp4", f, "video/mp4")
            with self.assertRaises(ValueError):
                self.api.upload_file("worker/../x.mp4", f, "video/mp4")
            empty = Path(d) / "e.mp4"
            empty.write_bytes(b"")
            with self.assertRaises(ApiError):
                self.api.upload_file(result_path("t2"), empty, "video/mp4")

    def test_empty_queue(self):
        class Empty(_Handler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                self.rfile.read(length)
                self._reply(200, [])

        server = HTTPServer(("127.0.0.1", 0), Empty)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            cfg = WorkerConfig(**{**self.config.__dict__, "supabase_url": f"http://127.0.0.1:{server.server_port}"})
            self.assertIsNone(SupabaseApi(cfg, sleep=lambda s: None).claim_task())
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
