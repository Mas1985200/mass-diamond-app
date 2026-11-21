# video-worker/tests/test_kaggle_start.py
# The Kaggle launcher's safe parts: secrets are read and checked, never printed,
# and the GitHub token never ends up in an address. Run from the video-worker
# folder:
#   python -m unittest tests.test_kaggle_start

import base64
import importlib.util
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "kaggle_start", Path(__file__).resolve().parent.parent / "launch" / "kaggle_start.py"
)
start = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(start)

FULL = {
    "SUPABASE_URL": "https://x.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "service-key-123",
    "GITHUB_TOKEN": "ghp_tokenvalue",
    "HF_TOKEN": "hf_abc",
}


class LauncherTests(unittest.TestCase):
    def test_all_secrets_are_read_and_trimmed(self):
        found = start.read_secrets(lambda name: "  " + FULL[name] + "\n")
        self.assertEqual(found, FULL)

    def test_the_optional_secret_may_be_missing(self):
        found = start.read_secrets(lambda name: FULL[name] if name != "HF_TOKEN" else "")
        self.assertNotIn("HF_TOKEN", found)
        self.assertEqual(len(found), 3)

    def test_every_missing_secret_is_named_at_once_and_none_is_leaked(self):
        def getter(name):
            if name == "SUPABASE_SERVICE_ROLE_KEY":
                raise RuntimeError("not set")  # Kaggle raises for an unset secret
            if name == "GITHUB_TOKEN":
                return None
            return FULL[name]

        with self.assertRaises(SystemExit) as caught:
            start.read_secrets(getter)
        message = str(caught.exception)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", message)
        self.assertIn("GITHUB_TOKEN", message)
        self.assertNotIn("SUPABASE_URL", message)

    def test_scrub_removes_secrets_and_their_encoded_form(self):
        encoded = base64.b64encode(b"x-access-token:ghp_tokenvalue").decode()
        text = "fail service-key-123 and ghp_tokenvalue and " + encoded + " hf_abc"
        cleaned = start.scrub(text, FULL)
        for secret in ("service-key-123", "ghp_tokenvalue", encoded, "hf_abc"):
            self.assertNotIn(secret, cleaned)
        self.assertEqual(start.scrub("nothing secret", FULL), "nothing secret")

    def test_the_token_is_in_a_header_never_in_the_address(self):
        command = start.clone_command("ghp_tokenvalue", Path("/kaggle/working/x"))
        self.assertNotIn("ghp_tokenvalue", " ".join(command))
        self.assertEqual(command[0], "git")
        self.assertIn(start.REPO_URL, command)
        self.assertIn("--depth", command)
        header = command[2].split("Basic ", 1)[1]
        self.assertEqual(base64.b64decode(header), b"x-access-token:ghp_tokenvalue")

    def test_the_worker_gets_only_what_it_needs(self):
        env = start.worker_environment(FULL, {"PATH": "/bin"})
        self.assertEqual(env["SUPABASE_URL"], FULL["SUPABASE_URL"])
        self.assertEqual(env["SUPABASE_SERVICE_ROLE_KEY"], FULL["SUPABASE_SERVICE_ROLE_KEY"])
        self.assertEqual(env["HF_TOKEN"], "hf_abc")
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertEqual(env["PATH"], "/bin")
        without = start.worker_environment({k: v for k, v in FULL.items() if k != "HF_TOKEN"}, {})
        self.assertNotIn("HF_TOKEN", without)

    def test_the_fatal_exit_code_is_the_same_in_the_worker_and_the_launcher(self):
        from worker.main import FATAL_EXIT_CODE

        self.assertEqual(start.FATAL_EXIT_CODE, FATAL_EXIT_CODE)
        self.assertNotEqual(FATAL_EXIT_CODE, 1)  # 1 is what a crash gives

    def test_a_failed_command_shows_a_cleaned_message(self):
        with self.assertRaises(SystemExit) as caught:
            start.run_checked(
                ["python3", "-c", "import sys; sys.stderr.write('boom ghp_tokenvalue'); sys.exit(3)"],
                FULL,
            )
        message = str(caught.exception)
        self.assertIn("boom", message)
        self.assertNotIn("ghp_tokenvalue", message)


if __name__ == "__main__":
    unittest.main()
