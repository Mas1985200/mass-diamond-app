// tests/video/video-watcher.test.ts
// The loop that watches a video: what it reports, when it stops, how long it
// waits. A fake network and a fake clock, so it runs instantly.

import test from "node:test";
import assert from "node:assert/strict";

import { watchVideo, START_STATE, type WatchState } from "../../src/features/video/videoWatcher.ts";
import type { CallOutcome } from "../../src/features/video/videoApi.ts";
import type { JobStatus } from "../../src/features/video/videoCard.ts";
import { POLL_FAIL_MAX_MS, POLL_FIRST_MS, POLL_HIDDEN_MS } from "../../src/features/video/videoCard.ts";

const ID = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

const job = (status: JobStatus, over: Record<string, unknown> = {}): CallOutcome => ({
  kind: "answer",
  answer: {
    ok: true,
    job: { id: ID, status, progress: 0, errorCode: null, videoUrl: null, thumbnailUrl: null, ...over },
  },
});
const refused = (code: string, retryable: boolean): CallOutcome => ({ kind: "answer", answer: { ok: false, code, retryable } });
const unreachable: CallOutcome = { kind: "unreachable" };

function run(outcomes: CallOutcome[], options: { hidden?: boolean } = {}) {
  const states: WatchState[] = [];
  const waits: number[] = [];
  let asked = 0;
  const controller = new AbortController();
  const done = watchVideo(
    {
      api: {
        status: async () => {
          const next = outcomes[asked++];
          if (!next) {
            controller.abort();
            return { kind: "aborted" } as CallOutcome;
          }
          return next;
        },
      },
      wait: async (ms) => { waits.push(ms); },
      isHidden: () => options.hidden === true,
    },
    ID,
    (state) => states.push(state),
    controller.signal,
  );
  return { done, states, waits, asked: () => asked };
}

test("it reports each answer and stops when the video is ready", async () => {
  const r = run([job("queued"), job("processing", { progress: 40 }), job("succeeded", { progress: 100, videoUrl: "https://v/x.mp4" })]);
  await r.done;
  assert.deepEqual(r.states.map((s) => s.job?.status), ["queued", "processing", "succeeded"]);
  assert.equal(r.states[2].job?.videoUrl, "https://v/x.mp4");
  assert.equal(r.asked(), 3);
  assert.equal(r.waits.length, 2);
});

test("it stops for a failed or canceled video too", async () => {
  const failed = run([job("processing"), job("failed", { errorCode: "timeout" }), job("queued")]);
  await failed.done;
  assert.equal(failed.asked(), 2);
  assert.equal(failed.states[1].job?.errorCode, "timeout");
  const canceled = run([job("canceled"), job("queued")]);
  await canceled.done;
  assert.equal(canceled.asked(), 1);
});

test("the waits start quick and grow while the video is still being made", async () => {
  const r = run([job("queued"), job("processing"), job("processing"), job("succeeded", { videoUrl: "https://v/x.mp4" })]);
  await r.done;
  assert.equal(r.waits[0], POLL_FIRST_MS + 1_000);
  assert.ok(r.waits[1] > r.waits[0]);
});

test("no internet is shown as offline, the asking goes on, and the old answer stays", async () => {
  const r = run([job("processing", { progress: 30 }), unreachable, unreachable, job("processing", { progress: 50 }), job("succeeded", { videoUrl: "https://v/x.mp4" })]);
  await r.done;
  assert.deepEqual(r.states.map((s) => s.offline), [false, true, true, false, false]);
  assert.equal(r.states[1].job?.progress, 30);
  assert.equal(r.states[3].job?.progress, 50);
  assert.equal(r.waits[1], 5_000);
  assert.equal(r.waits[2], 10_000);
});

test("a long cut never makes the waits longer than the limit", async () => {
  const r = run(Array.from({ length: 12 }, () => unreachable));
  await r.done;
  assert.ok(Math.max(...r.waits) <= POLL_FAIL_MAX_MS);
  assert.equal(r.waits[r.waits.length - 1], POLL_FAIL_MAX_MS);
});

test("a hidden page is asked rarely", async () => {
  const r = run([job("processing"), job("succeeded", { videoUrl: "https://v/x.mp4" })], { hidden: true });
  await r.done;
  assert.equal(r.waits[0], POLL_HIDDEN_MS);
});

test("a missing video or a refusal ends the watching with missing", async () => {
  const gone = run([job("processing"), refused("JOB_NOT_FOUND", false), job("queued")]);
  await gone.done;
  assert.equal(gone.asked(), 2);
  assert.equal(gone.states[1].missing, true);
  const signedOut = run([refused("AUTH_REQUIRED", false)]);
  await signedOut.done;
  assert.equal(signedOut.states[0].missing, true);
});

test("a temporary server error is tried again", async () => {
  const r = run([refused("INTERNAL_ERROR", true), job("queued"), job("succeeded", { videoUrl: "https://v/x.mp4" })]);
  await r.done;
  assert.deepEqual(r.states.map((s) => [s.offline, s.job?.status ?? null]), [[true, null], [false, "queued"], [false, "succeeded"]]);
});

test("the caller can stop it: nothing more is reported after the abort", async () => {
  const states: WatchState[] = [];
  const controller = new AbortController();
  let asked = 0;
  await watchVideo(
    {
      api: {
        status: async () => {
          asked += 1;
          if (asked === 2) controller.abort();
          return job("processing");
        },
      },
      wait: async () => {},
      isHidden: () => false,
    },
    ID,
    (state) => states.push(state),
    controller.signal,
  );
  assert.equal(asked, 2);
  assert.equal(states.length, 1);
});

test("it can continue from what the card already knows", async () => {
  const known: WatchState = { job: { id: ID, status: "processing", progress: 70, errorCode: null, videoUrl: null, thumbnailUrl: null }, missing: false, offline: false };
  const states: WatchState[] = [];
  const controller = new AbortController();
  let asked = 0;
  await watchVideo(
    {
      api: {
        status: async () => {
          asked += 1;
          if (asked === 2) controller.abort();
          return unreachable;
        },
      },
      wait: async () => {},
      isHidden: () => false,
    },
    ID,
    (s) => states.push(s),
    controller.signal,
    known,
  );
  assert.equal(states.length, 1);
  assert.equal(states[0].job?.progress, 70);
  assert.equal(states[0].offline, true);
  assert.equal(START_STATE.job, null);
});
