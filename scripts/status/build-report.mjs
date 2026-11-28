// scripts/status/build-report.mjs
// Builds the status report of one commit: it reads what the workflow already
// produced (test output, the outcome of each stage), runs the tests that are
// connected to the person's requirements one by one, calls the live app and
// functions, and writes status-out/latest.md and status-out/latest.json.
// The judging and drawing rules live in lib.mjs and are covered by tests.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

import {
  excerpt,
  judgeAppResponse,
  judgeFunctionResponse,
  parseFailedNames,
  parseTestTotals,
  renderMarkdown,
  requirementState,
} from "./lib.mjs";

const SUPABASE_URL = "https://xcmvzyoadzhyyrsgywnv.supabase.co";
const APP_URL = "https://mass-diamond-app.mas1985dimond.workers.dev/";
const FUNCTIONS = ["ai-chat", "video-engine", "transcribe"];

// A deploy can finish a little after the push, so each live check is repeated
// for a short while before it is called a failure.
const LIVE_ATTEMPTS = 6;
const LIVE_PAUSE_MS = 20_000;
const LIVE_TIMEOUT_MS = 10_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

async function attempt(label, run) {
  let last = { ok: false, detail: "no answer" };

  for (let index = 0; index < LIVE_ATTEMPTS; index += 1) {
    try {
      last = await run();
    } catch (error) {
      last = { ok: false, detail: `no answer (${String(error?.name ?? "error")})` };
    }

    if (last.ok) {
      break;
    }

    if (index < LIVE_ATTEMPTS - 1) {
      await pause(LIVE_PAUSE_MS);
    }
  }

  return { label, ...last };
}

async function runLiveChecks() {
  if (process.env.SKIP_LIVE === "1") {
    return [];
  }

  const checks = [];

  checks.push(
    await attempt("اپ (Cloudflare)", async () => {
      const response = await fetch(APP_URL, {
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      });

      return judgeAppResponse(response.status, await response.text());
    }),
  );

  for (const name of FUNCTIONS) {
    checks.push(
      await attempt(`تابع ${name}`, async () => {
        // No sign-in on purpose: a running function refuses with 400 or 401.
        const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
        });

        return judgeFunctionResponse(response.status);
      }),
    );
  }

  return checks;
}

function runTestFile(file) {
  const result = spawnSync(process.execPath, ["--test", file], {
    encoding: "utf8",
    timeout: 120_000,
  });

  return result.status === 0;
}

const requirementsSource = JSON.parse(
  readFileSync(new URL("./requirements.json", import.meta.url), "utf8"),
);

const connectedFiles = [
  ...new Set(requirementsSource.flatMap((item) => item.tests)),
];
const fileResults = Object.fromEntries(
  connectedFiles.map((file) => [file, runTestFile(file)]),
);

const testOutput = readIfExists("test-output.txt");
const outcomes = {
  install: process.env.STAGE_INSTALL ?? "skipped",
  tests: process.env.STAGE_TESTS ?? "skipped",
  types: process.env.STAGE_TYPES ?? "skipped",
  build: process.env.STAGE_BUILD ?? "skipped",
};

const time = new Date().toLocaleString("sv-SE", {
  timeZone: "Asia/Tehran",
  hour12: false,
});

const report = {
  commit: process.env.COMMIT_SHA ?? "unknown",
  message: (process.env.COMMIT_MESSAGE ?? "").split("\n")[0],
  time: `${time} (تهران)`,
  stages: [
    { id: "install", label: "نصب پکیج‌ها", outcome: outcomes.install },
    { id: "tests", label: "تست‌های واحد", outcome: outcomes.tests },
    { id: "types", label: "بررسی نوع‌ها (tsc)", outcome: outcomes.types },
    { id: "build", label: "ساخت اپ (vite build)", outcome: outcomes.build },
  ],
  details: [
    {
      label: "بررسی نوع‌ها",
      lines: outcomes.types === "failure" ? excerpt(readIfExists("types-output.txt")) : [],
    },
    {
      label: "ساخت اپ",
      lines: outcomes.build === "failure" ? excerpt(readIfExists("build-output.txt")) : [],
    },
  ],
  tests: parseTestTotals(testOutput),
  failedTests: parseFailedNames(testOutput),
  live: await runLiveChecks(),
  requirements: requirementsSource.map((item) => ({
    id: item.id,
    text: item.text,
    state: requirementState(item, fileResults),
  })),
};

mkdirSync("status-out", { recursive: true });
writeFileSync("status-out/latest.json", `${JSON.stringify(report, null, 2)}\n`);
writeFileSync("status-out/latest.md", renderMarkdown(report));

console.log(renderMarkdown(report));
