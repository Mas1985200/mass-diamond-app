# video-worker/worker/pipeline/images.py
# Brings the person's pictures to the worker: one https link in, one file out.
# The links are short-lived signed links made by the video engine. The download
# is bounded (size and time), only https is followed, a link that points inside
# a private network is refused, and the file must really be a picture (checked
# by its first bytes), so a wrong or hostile link can never reach the model.

from __future__ import annotations

import ipaddress
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from ..models.base import BackendError

MAX_IMAGE_BYTES = 20 * 1024 * 1024
TIMEOUT_SECONDS = 30
_CHUNK = 64 * 1024
_TRANSIENT_STATUS = {408, 425, 429, 500, 502, 503, 504}

Opener = Callable[..., Any]


def _looks_like_image(head: bytes) -> bool:
    return (
        head.startswith(b"\x89PNG\r\n\x1a\n")
        or head.startswith(b"\xff\xd8\xff")
        or head.startswith((b"GIF87a", b"GIF89a"))
        or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")
    )


def _check_link(link: str) -> urllib.parse.ParseResult:
    try:
        parts = urllib.parse.urlparse(link)
    except ValueError as error:
        raise BackendError("bad_image", "A picture link is not valid.", False) from error
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host:
        raise BackendError("bad_image", "Only https picture links are followed.", False)
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".internal"):
        raise BackendError("bad_image", "A picture link points to a private address.", False)
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return parts  # a name, not a number
    if not address.is_global:
        raise BackendError("bad_image", "A picture link points to a private address.", False)
    return parts


def download_image(
    link: str,
    destination: Path,
    opener: Opener = urllib.request.urlopen,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> None:
    """Saves the picture at `link` to `destination`, or raises BackendError."""
    _check_link(link)
    request = urllib.request.Request(link, headers={"User-Agent": "mass-diamond-worker"})
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".part")

    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            final = urllib.parse.urlparse(response.geturl())
            if final.scheme != "https":
                raise BackendError("bad_image", "A picture link led to a non-https address.", False)
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise BackendError("bad_image", "A picture is too large.", False)

            total = 0
            head = b""
            with open(partial, "wb") as out:
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise BackendError("bad_image", "A picture is too large.", False)
                    if len(head) < 16:
                        head = (head + chunk)[:16]
                    out.write(chunk)
        if total == 0 or not _looks_like_image(head):
            raise BackendError("bad_image", "The link is not a picture.", False)
        partial.replace(destination)
    except BackendError:
        partial.unlink(missing_ok=True)
        raise
    except urllib.error.HTTPError as error:
        partial.unlink(missing_ok=True)
        # An expired or wrong link never works again; a busy server may.
        transient = error.code in _TRANSIENT_STATUS
        raise BackendError(
            "image_download_failed", f"A picture could not be downloaded ({error.code}).", transient
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        partial.unlink(missing_ok=True)
        raise BackendError(
            "image_download_failed", "A picture could not be downloaded.", True
        ) from error
