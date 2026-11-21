# video-worker/launch/kaggle_start.py
# Starts a Mass Diamond video worker inside a Kaggle notebook (free GPU). Paste
# this whole file into ONE code cell of a Kaggle notebook and run it. It
#   1. reads the secrets from Kaggle's "Secrets" (never written in the notebook),
#   2. downloads the worker code from GitHub,
#   3. installs what the worker needs,
#   4. runs the worker, and starts it again if it stops by itself.
#
# Secrets to add in the notebook (Add-ons > Secrets), all required except the last:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN (read access to the repo)
#   HF_TOKEN (optional: faster model download)
# The notebook must stay PRIVATE, and Internet and GPU must be switched on in its
# settings. Secrets are never printed: every message is cleaned of them first.

import base64
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_URL = "https://github.com/Mas1985200/mass-diamond-app.git"
BRANCH = "dev"
CHECKOUT = Path("/kaggle/working/mass-diamond-app")
REQUIRED = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GITHUB_TOKEN")
OPTIONAL = ("HF_TOKEN",)
RESTART_DELAY_SECONDS = 20
FATAL_EXIT_CODE = 3  # the worker says "I can never work here" (no GPU); a crash is 1, so it is started again


def read_secrets(getter):
    """Reads the secrets with `getter(name)`. Names missing or empty are listed
    together in one clear message."""
    found, missing = {}, []
    for name in REQUIRED:
        value = _safe_get(getter, name)
        if value:
            found[name] = value
        else:
            missing.append(name)
    if missing:
        raise SystemExit("Missing Kaggle secrets: " + ", ".join(missing))
    for name in OPTIONAL:
        value = _safe_get(getter, name)
        if value:
            found[name] = value
    return found


def _safe_get(getter, name):
    try:
        return (getter(name) or "").strip()
    except Exception:  # a secret that is not set raises in Kaggle
        return ""


def scrub(text, secrets):
    """Removes every secret (and its base64 form) from a text."""
    cleaned = str(text)
    for value in secrets.values():
        if value:
            cleaned = cleaned.replace(value, "***")
            cleaned = cleaned.replace(base64.b64encode(("x-access-token:" + value).encode()).decode(), "***")
    return cleaned


def clone_command(token, checkout):
    """git clone with the token in a header, never in the address, so it is not
    stored in the repository's settings."""
    header = base64.b64encode(("x-access-token:" + token).encode()).decode()
    return [
        "git", "-c", "http.extraheader=Authorization: Basic " + header,
        "clone", "--depth", "1", "--branch", BRANCH, REPO_URL, str(checkout),
    ]


def worker_environment(secrets, base):
    env = dict(base)
    env["SUPABASE_URL"] = secrets["SUPABASE_URL"]
    env["SUPABASE_SERVICE_ROLE_KEY"] = secrets["SUPABASE_SERVICE_ROLE_KEY"]
    if "HF_TOKEN" in secrets:
        env["HF_TOKEN"] = secrets["HF_TOKEN"]
    env["PYTHONUNBUFFERED"] = "1"
    return env


def run_checked(command, secrets, **kwargs):
    done = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if done.returncode != 0:
        tail = scrub((done.stderr or done.stdout)[-1500:], secrets)
        raise SystemExit("Command failed (" + command[0] + "): " + tail)


def main():
    from kaggle_secrets import UserSecretsClient  # only exists inside Kaggle

    secrets = read_secrets(UserSecretsClient().get_secret)

    shutil.rmtree(CHECKOUT, ignore_errors=True)
    print("Downloading the worker code...")
    run_checked(clone_command(secrets["GITHUB_TOKEN"], CHECKOUT), secrets)

    folder = CHECKOUT / "video-worker"
    print("Installing the libraries (a few minutes the first time)...")
    run_checked(
        [sys.executable, "-m", "pip", "install", "-q", "-r", str(folder / "requirements.txt")],
        secrets,
    )

    env = worker_environment(secrets, os.environ)
    print("Starting the worker. Stop the cell to stop the worker.")
    while True:
        code = subprocess.call([sys.executable, "-m", "worker.main"], cwd=folder, env=env)
        if code == FATAL_EXIT_CODE:
            raise SystemExit("The worker cannot work on this machine (is the GPU switched on?).")
        print("The worker stopped (code " + str(code) + "). Starting it again in "
              + str(RESTART_DELAY_SECONDS) + " seconds...")
        time.sleep(RESTART_DELAY_SECONDS)


if __name__ == "__main__":
    main()
