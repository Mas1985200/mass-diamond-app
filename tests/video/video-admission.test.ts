// tests/video/video-admission.test.ts
// The doorman of the video queue: the limits read from secrets, the reading of
// the counts, and the decision to let a video in or ask the person to wait.
// Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_ACTIVE_PER_USER,
  DEFAULT_MAX_QUEUE,
  RETRY_AFTER_QUEUE_FULL_SECONDS,
  RETRY_AFTER_TOO_MANY_ACTIVE_SECONDS,
  decideAdmission,
  parseCount,
  readAdmissionLimits,
} from "../../supabase/functions/video-engine/admission.ts";

const limits = { maxActivePerUser: 2, maxQueue: 100 };

test("limits come from secrets; a typo falls back to the default", () => {
  assert.deepEqual(readAdmissionLimits(() => undefined), {
    maxActivePerUser: DEFAULT_MAX_ACTIVE_PER_USER,
    maxQueue: DEFAULT_MAX_QUEUE,
  });
  const env: Record<string, string> = {
    VIDEO_MAX_ACTIVE_PER_USER: "3",
    VIDEO_MAX_QUEUE: "500",
  };
  assert.deepEqual(readAdmissionLimits((name) => env[name]), {
    maxActivePerUser: 3,
    maxQueue: 500,
  });
  const typos: Record<string, string> = {
    VIDEO_MAX_ACTIVE_PER_USER: "many",
    VIDEO_MAX_QUEUE: "-1",
  };
  assert.deepEqual(readAdmissionLimits((name) => typos[name]), {
    maxActivePerUser: DEFAULT_MAX_ACTIVE_PER_USER,
    maxQueue: DEFAULT_MAX_QUEUE,
  });
});

test("a count is a whole number of 0 or more, or unknown", () => {
  assert.equal(parseCount(0), 0);
  assert.equal(parseCount(12), 12);
  assert.equal(parseCount(-1), null);
  assert.equal(parseCount(1.5), null);
  assert.equal(parseCount(Number.NaN), null);
  assert.equal(parseCount("3"), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
});

test("a video enters while the person and the queue have room", () => {
  assert.deepEqual(decideAdmission({ userActive: 0, totalActive: 0 }, limits), { ok: true });
  assert.deepEqual(decideAdmission({ userActive: 1, totalActive: 99 }, limits), { ok: true });
});

test("a person cannot fill the queue alone", () => {
  assert.deepEqual(decideAdmission({ userActive: 2, totalActive: 5 }, limits), {
    ok: false,
    code: "too_many_active",
    retryAfterSeconds: RETRY_AFTER_TOO_MANY_ACTIVE_SECONDS,
    limit: 2,
  });
  assert.equal(decideAdmission({ userActive: 7, totalActive: 7 }, limits).ok, false);
});

test("a full queue asks everybody to come back in a moment", () => {
  assert.deepEqual(decideAdmission({ userActive: 0, totalActive: 100 }, limits), {
    ok: false,
    code: "queue_full",
    retryAfterSeconds: RETRY_AFTER_QUEUE_FULL_SECONDS,
    limit: 100,
  });
  assert.equal(decideAdmission({ userActive: 0, totalActive: 250 }, limits).ok, false);
});

test("the person's own limit is told first when both are reached", () => {
  const decision = decideAdmission({ userActive: 2, totalActive: 100 }, limits);
  assert.equal(decision.ok === false && decision.code, "too_many_active");
});

test("a queue limit of 0 closes the door for new videos", () => {
  const closed = { maxActivePerUser: 2, maxQueue: 0 };
  const decision = decideAdmission({ userActive: 0, totalActive: 0 }, closed);
  assert.equal(decision.ok === false && decision.code, "queue_full");
});
