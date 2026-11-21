# video-worker/tests/test_images.py
# The picture download: only safe https links, bounded size, a real picture, and
# the right "try again?" answer for every kind of failure. A fake opener stands in
# for the network. Run from the video-worker folder:
#   python -m unittest tests.test_images

from __future__ import annotations

import io
import tempfile
import unittest
import urllib.error
from pathlib import Path

from worker.models.base import BackendError
from worker.pipeline.images import download_image

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64


class FakeResponse:
    def __init__(self, body: bytes, final_url: str = "https://files.example/a.png", length: str | None = None):
        self._stream = io.BytesIO(body)
        self._final = final_url
        self.headers = {} if length is None else {"Content-Length": length}

    def read(self, n: int = -1) -> bytes:
        return self._stream.read(n)

    def geturl(self) -> str:
        return self._final

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def opener_for(response: FakeResponse):
    def opener(request, timeout):  # noqa: ANN001
        return response

    return opener


def raising(error: BaseException):
    def opener(request, timeout):  # noqa: ANN001
        raise error

    return opener


class DownloadImageTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dest = Path(self._tmp.name) / "deep" / "pic.img"

    def fail(self, link: str, opener, **kw) -> BackendError:  # noqa: ANN001
        with self.assertRaises(BackendError) as caught:
            download_image(link, self.dest, opener, **kw)
        self.assertFalse(self.dest.exists())
        self.assertEqual(list(self.dest.parent.glob("*.part")) if self.dest.parent.exists() else [], [])
        return caught.exception

    def test_every_picture_kind_is_saved(self) -> None:
        for body in (PNG, JPEG, WEBP, GIF):
            download_image("https://files.example/a", self.dest, opener_for(FakeResponse(body)))
            self.assertEqual(self.dest.read_bytes(), body)
            self.dest.unlink()

    def test_unsafe_links_are_refused_without_any_request(self) -> None:
        calls: list[int] = []

        def opener(request, timeout):  # noqa: ANN001
            calls.append(1)
            return FakeResponse(PNG)

        for link in (
            "http://files.example/a.png",
            "ftp://files.example/a.png",
            "file:///etc/passwd",
            "https:///nohost",
            "https://localhost/a.png",
            "https://x.localhost/a.png",
            "https://db.internal/a.png",
            "https://127.0.0.1/a.png",
            "https://10.0.0.5/a.png",
            "https://192.168.1.1/a.png",
            "https://169.254.169.254/latest",
            "https://[::1]/a.png",
            "not a link",
        ):
            error = self.fail(link, opener)
            self.assertFalse(error.retryable, link)
            self.assertEqual(error.code, "bad_image", link)
        self.assertEqual(calls, [])

    def test_a_public_ip_is_allowed(self) -> None:
        download_image("https://8.8.8.8/a.png", self.dest, opener_for(FakeResponse(PNG)))
        self.assertTrue(self.dest.exists())

    def test_a_redirect_to_plain_http_is_refused(self) -> None:
        error = self.fail(
            "https://files.example/a.png",
            opener_for(FakeResponse(PNG, final_url="http://files.example/a.png")),
        )
        self.assertFalse(error.retryable)

    def test_a_picture_that_is_too_large_is_refused_early_and_while_streaming(self) -> None:
        declared = self.fail(
            "https://files.example/a.png",
            opener_for(FakeResponse(PNG, length="999999")),
            max_bytes=1000,
        )
        self.assertFalse(declared.retryable)
        streamed = self.fail(
            "https://files.example/a.png",
            opener_for(FakeResponse(PNG + b"\x00" * 5000)),
            max_bytes=1000,
        )
        self.assertFalse(streamed.retryable)

    def test_something_that_is_not_a_picture_is_refused(self) -> None:
        for body in (b"", b"<html>not found</html>", b"GIF", b"RIFF1234WAVE"):
            error = self.fail("https://files.example/a.png", opener_for(FakeResponse(body)))
            self.assertEqual(error.code, "bad_image")
            self.assertFalse(error.retryable)

    def test_http_errors_decide_if_trying_again_can_help(self) -> None:
        def http(code: int) -> urllib.error.HTTPError:
            return urllib.error.HTTPError("https://files.example/a", code, "x", {}, None)  # type: ignore[arg-type]

        for code, retryable in ((403, False), (404, False), (400, False), (429, True), (500, True), (503, True)):
            error = self.fail("https://files.example/a.png", raising(http(code)))
            self.assertEqual(error.code, "image_download_failed")
            self.assertEqual(error.retryable, retryable, code)

    def test_network_trouble_is_worth_trying_again(self) -> None:
        for problem in (urllib.error.URLError("offline"), TimeoutError("slow"), ConnectionResetError("reset")):
            error = self.fail("https://files.example/a.png", raising(problem))
            self.assertTrue(error.retryable)

    def test_an_older_file_is_replaced_and_no_partial_file_is_left(self) -> None:
        self.dest.parent.mkdir(parents=True)
        self.dest.write_bytes(b"old")
        download_image("https://files.example/a.png", self.dest, opener_for(FakeResponse(PNG)))
        self.assertEqual(self.dest.read_bytes(), PNG)
        self.assertEqual(list(self.dest.parent.glob("*.part")), [])


if __name__ == "__main__":
    unittest.main()
