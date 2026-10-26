// tests/voice/retry-policy.test.ts
// The waiting between automatic tries grows, is capped, and the person is never
// kept waiting beyond the total budget. Pure functions, nothing is faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ATTEMPTS,
  RETRY_MAX_PAUSE_MS,
  TOTAL_BUDGET_MS,
  mayTryAgain,
  retryPauseMs,
  shouldKeepRecording,
} from "../../src/features/voice/retryPolicy.ts";

test("the pause grows with every failed try", () => {
  assert.equal(retryPauseMs(1), 600);
  assert.equal(retryPauseMs(2), 1_200);
  assert.equal(retryPauseMs(3), 2_400);
});

test("the pause never goes above the cap", () => {
  assert.equal(retryPauseMs(4), RETRY_MAX_PAUSE_MS);
  assert.equal(retryPauseMs(50), RETRY_MAX_PAUSE_MS);
});

test("a wrong attempt number is treated as the first one", () => {
  assert.equal(retryPauseMs(0), 600);
  assert.equal(retryPauseMs(-3), 600);
  assert.equal(retryPauseMs(Number.NaN), 600);
  assert.equal(retryPauseMs(Number.POSITIVE_INFINITY), 600);
});

test("another try is allowed until the limit of tries is reached", () => {
  assert.equal(mayTryAgain(1, 0), true);
  assert.equal(mayTryAgain(MAX_ATTEMPTS - 1, 0), true);
  assert.equal(mayTryAgain(MAX_ATTEMPTS, 0), false);
});

test("no try is started when its pause would pass the total budget", () => {
  const pause = retryPauseMs(1);

  assert.equal(mayTryAgain(1, TOTAL_BUDGET_MS - pause - 1), true);
  assert.equal(mayTryAgain(1, TOTAL_BUDGET_MS - pause), false);
  assert.equal(mayTryAgain(1, TOTAL_BUDGET_MS), false);
});

test("a lost connection or a slow-down request keeps the recording", () => {
  assert.equal(shouldKeepRecording("network", false), true);
  assert.equal(shouldKeepRecording("rate_limited", false), true);
});

test("a failure keeps the recording only when the service called it temporary", () => {
  assert.equal(shouldKeepRecording("failed", true), true);
  assert.equal(shouldKeepRecording("failed", false), false);
});

test("outcomes that sending again cannot fix never keep the recording", () => {
  for (const code of [
    "no_speech",
    "auth",
    "permission",
    "no_microphone",
    "unsupported",
    "unknown",
  ]) {
    assert.equal(shouldKeepRecording(code, true), false, code);
  }
});
